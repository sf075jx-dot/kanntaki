let appConfig = {};
let selectedCareLevelId = null;
let selectedBurdenRatioId = null;
let selectedAdditions = {}; 
let selectedOptions = {};   
let comparisonList = [];
let editingCardId = null; 
let uploadedLogoBase64 = null; 
let isLogoDeleted = false;     
let isAppInitialized = false;

// Python側（pywebview.api）の準備完了を確実に待ってから初期化する
async function waitForPywebviewAndInit() {
    if (isAppInitialized) return;

    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_config === 'function') {
        isAppInitialized = true;
        await loadAppData();
        return;
    }
}

// 1. pywebview公式の準備完了イベントで起動
window.addEventListener('pywebviewready', () => {
    waitForPywebviewAndInit();
});

// 2. タイミングのズレ対策：DOMContentLoaded後に最大3秒間、Pythonブリッジの接続を監視する
window.addEventListener('DOMContentLoaded', () => {
    let attempts = 0;
    const maxAttempts = 30; // 100ms × 30回 = 3秒間待機
    const timer = setInterval(async () => {
        attempts++;
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_config === 'function') {
            clearInterval(timer);
            await waitForPywebviewAndInit();
        } else if (attempts >= maxAttempts) {
            clearInterval(timer);
            if (!isAppInitialized) {
                isAppInitialized = true;
                await loadAppDataFromBrowserFallback();
            }
        }
    }, 100);
});

// ★ 再ビルド不要：Application Support に設定があればそれを使い、空なら web 内の config.json から自動復元・保存する
async function loadAppData() {
    try {
        appConfig = await window.pywebview.api.get_config();

        // Mac版で Application Support/config.json が未作成で空 `{}` が返ってきた場合のみ動作
        if (!appConfig || !appConfig.care_levels || appConfig.care_levels.length === 0) {
            const res = await fetch('config.json?t=' + Date.now());
            if (res.ok) {
                appConfig = await res.json();
                // Application Support/config.json に初期ファイルとして保存しておく（次回以降はそちらが読まれる）
                await window.pywebview.api.update_config(appConfig);
            }
        }

        applyConfigToState();
    } catch (e) {
        console.error("初期設定の取得に失敗しました", e);
    }
}

// ブラウザ単体で開いた場合のフォールバック
async function loadAppDataFromBrowserFallback() {
    try {
        const res = await fetch('config.json?t=' + Date.now());
        if (res.ok) {
            appConfig = await res.json();
            applyConfigToState();
        }
    } catch (e) {
        console.error("ブラウザでのconfig.json取得に失敗しました", e);
    }
}

function applyConfigToState() {
    if (appConfig.burden_ratios && appConfig.burden_ratios.length > 0 && !selectedBurdenRatioId) {
        selectedBurdenRatioId = appConfig.burden_ratios[0].id;
    }

    if (appConfig.care_levels && appConfig.care_levels.length > 0 && !selectedCareLevelId) {
        selectedCareLevelId = appConfig.care_levels[0].id;
    }

    if (appConfig.additions) {
        appConfig.additions.forEach(add => {
            if (!selectedAdditions[add.id]) {
                selectedAdditions[add.id] = { active: false, count: add.unit_type === 'days' ? 30 : 1 };
            }
        });
    }

    if (appConfig.options) {
        appConfig.options.forEach(opt => {
            if (!selectedOptions[opt.id]) {
                selectedOptions[opt.id] = { distance: 0, times: 0, count: 0 };
            }
        });
    }

    initUI();
    renderComparisonCards();
}

function toggleAccordion(sectionId, headerEl) {
    const content = document.getElementById(sectionId);
    const icon = headerEl.querySelector('.accordion-icon');
    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        icon.classList.remove('closed');
        icon.classList.add('open');
    } else {
        content.classList.add('collapsed');
        icon.classList.remove('open');
        icon.classList.add('closed');
    }
}

function initUI() {
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) {
        const facilityName = appConfig.facility_name || "利用料金シミュレーター";
        headerTitle.innerText = `${facilityName} 利用料金シミュレーション`;
    }

    const appLogoImg = document.getElementById('app-logo');
    if (appLogoImg) {
        if (appConfig.logo) {
            appLogoImg.src = appConfig.logo;
            appLogoImg.style.display = 'block';
        } else {
            appLogoImg.style.display = 'none';
        }
    }

    const burdenContainer = document.getElementById('burden-ratio-container');
    if (burdenContainer) {
        burdenContainer.innerHTML = '';
        if (appConfig.burden_ratios && Array.isArray(appConfig.burden_ratios) && appConfig.burden_ratios.length > 0) {
            appConfig.burden_ratios.forEach(br => {
                const isActive = (br.id === selectedBurdenRatioId) ? 'active' : '';
                const btn = document.createElement('div');
                btn.className = `burden-btn ${isActive}`;
                btn.innerText = br.name;
                btn.onclick = () => selectBurdenRatio(br.id);
                burdenContainer.appendChild(btn);
            });
        }
    }

    let currentRate = 0.1;
    if (appConfig.burden_ratios && Array.isArray(appConfig.burden_ratios)) {
        const foundRatio = appConfig.burden_ratios.find(br => br.id === selectedBurdenRatioId);
        if (foundRatio) {
            currentRate = foundRatio.rate;
        }
    }

    const unitPricePerUnit = appConfig.unit_price_per_unit || 10.14;

    const careContainer = document.getElementById('care-level-container');
    if (careContainer) {
        careContainer.innerHTML = '';
        if (appConfig.care_levels && Array.isArray(appConfig.care_levels) && appConfig.care_levels.length > 0) {
            if (!selectedCareLevelId || !appConfig.care_levels.some(cl => cl.id === selectedCareLevelId)) {
                selectedCareLevelId = appConfig.care_levels[0].id;
            }

            appConfig.care_levels.forEach(cl => {
                const isActive = (cl.id === selectedCareLevelId) ? 'active' : '';
                const baseFeeUnits = cl.base_fee || 0;
                const adjustedFee = Math.floor(Math.floor(baseFeeUnits * unitPricePerUnit) * currentRate);
                const btn = document.createElement('div');
                btn.className = `care-btn ${isActive}`;
                btn.innerHTML = `<div>${cl.name}</div><div style="font-size:10px; font-weight:normal; margin-top:2px; opacity:0.9;">¥${adjustedFee.toLocaleString()}</div>`;
                btn.onclick = () => selectCareLevel(cl.id);
                careContainer.appendChild(btn);
            });
        }
    }

    let activeAdditionsCount = 0;
    const additionsContainer = document.getElementById('additions-container');
    if (additionsContainer) {
        additionsContainer.innerHTML = '';
        if (appConfig.additions && Array.isArray(appConfig.additions)) {
            appConfig.additions.forEach(add => {
                if (!selectedAdditions[add.id]) {
                    selectedAdditions[add.id] = { active: false, count: add.unit_type === 'days' ? 30 : 1 };
                }
                const state = selectedAdditions[add.id];
                if (state.active) activeAdditionsCount++;

                const isActive = state.active ? 'active' : '';
                const statusText = state.active ? '適用中' : 'なし';
                
                const unitType = add.unit_type || 'month';
                let priceLabel = '';
                let unitName = '';
                const unitPriceVal = add.unit_price !== undefined ? add.unit_price : 0;

                if (unitType === 'days') {
                    priceLabel = `${unitPriceVal} 単位 /日`;
                    unitName = '日';
                } else if (unitType === 'times') {
                    priceLabel = `${unitPriceVal} 単位 /回`;
                    unitName = '回';
                } else if (unitType === 'percent') {
                    priceLabel = `${unitPriceVal}% (総単位数に対して)`;
                } else {
                    priceLabel = `${unitPriceVal} 単位 /月`;
                }

                const showInput = (unitType !== 'month' && unitType !== 'percent');

                const card = document.createElement('div');
                card.className = `addition-card ${isActive}`;
                card.innerHTML = `
                    <div class="addition-main" onclick="toggleAddition('${add.id}')">
                        <div class="addition-info">
                            <span class="addition-name">${add.name || ''}</span>
                            <span class="addition-price">${priceLabel}</span>
                        </div>
                        <div class="addition-status">${statusText}</div>
                    </div>
                    <div class="addition-count-area ${showInput && state.active ? 'show-count' : ''}">
                        <span>利用${unitName}数:</span>
                        <input type="number" id="add_count_${add.id}" min="1" value="${state.count || 1}" onclick="event.stopPropagation()" oninput="updateAdditionCount('${add.id}', this.value)">
                        <span>${unitName}</span>
                    </div>
                `;
                additionsContainer.appendChild(card);
            });
        }
    }
    const additionsBadge = document.getElementById('additions-badge');
    if (additionsBadge) additionsBadge.innerText = `選択: ${activeAdditionsCount}件`;

    let activeOptionsCount = 0;
    const optionsContainer = document.getElementById('options-container');
    if (optionsContainer) {
        optionsContainer.innerHTML = '';
        if (appConfig.options && Array.isArray(appConfig.options)) {
            appConfig.options.forEach(opt => {
                if (!selectedOptions[opt.id]) {
                    selectedOptions[opt.id] = { distance: 0, times: 0, count: 0 };
                }
                const optState = selectedOptions[opt.id];
                const unitType = opt.unit_type || 'times';

                let hasValue = false;
                let controlHtml = '';
                let priceSubLabel = '';
                const optPriceVal = opt.unit_price !== undefined ? opt.unit_price : 0;

                if (unitType === 'distance') {
                    if ((optState.distance > 0) && (optState.times > 0)) hasValue = true;
                    controlHtml = `
                        <div class="option-control">
                            <input type="number" id="opt_dist_${opt.id}" min="0" step="0.1" value="${optState.distance}" style="width: 58px;" placeholder="km" oninput="updateOptionDistance('${opt.id}', this.value)">
                            <span style="font-size:11px; color:var(--text-sub);">km ×</span>
                            <input type="number" id="opt_times_${opt.id}" min="0" value="${optState.times}" style="width: 48px;" placeholder="回" oninput="updateOptionTimes('${opt.id}', this.value)">
                            <span style="font-size:11px; color:var(--text-sub);">回</span>
                        </div>
                    `;
                    priceSubLabel = `¥${optPriceVal.toLocaleString()} / km・回`;
                } else {
                    if (optState.count > 0) hasValue = true;
                    const unitLabel = '回・日';
                    priceSubLabel = `¥${optPriceVal.toLocaleString()} / 回・日`;
                    controlHtml = `
                        <div class="option-control">
                            <input type="number" id="opt_${opt.id}" min="0" value="${optState.count}" oninput="updateOptionCount('${opt.id}', this.value)">
                            <span style="font-size:11px; color:var(--text-sub);">${unitLabel}</span>
                        </div>
                    `;
                }

                if (hasValue) activeOptionsCount++;

                const itemDiv = document.createElement('div');
                itemDiv.id = `opt_item_${opt.id}`;
                itemDiv.className = `option-item ${hasValue ? 'has-value' : ''}`;
                itemDiv.innerHTML = `
                    <div class="option-info">
                        <span class="option-name" style="font-weight: 700; font-size: 13px; color: var(--text-main); display: block;">${opt.name || ''}</span>
                        <span class="option-price" style="font-size: 11px; color: var(--text-sub);">${priceSubLabel}</span>
                    </div>
                    <div>${controlHtml}</div>
                `;
                optionsContainer.appendChild(itemDiv);
            });
        }
    }
    const optionsBadge = document.getElementById('options-badge');
    if (optionsBadge) optionsBadge.innerText = `選択: ${activeOptionsCount}件`;

    updateEditModeUI();
}

function updateEditModeUI() {
    const inputPanel = document.getElementById('input-panel-container');
    const editingBanner = document.getElementById('editing-banner');
    const editingBannerText = document.getElementById('editing-banner-text');
    const submitBtn = document.getElementById('submit-plan-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');

    if (editingCardId !== null) {
        const targetIndex = comparisonList.findIndex(item => item.id === editingCardId);
        const planNum = targetIndex !== -1 ? targetIndex + 1 : '';
        if (inputPanel) inputPanel.classList.add('is-editing-mode');
        if (editingBanner) editingBanner.style.display = 'flex';
        if (editingBannerText) editingBannerText.innerText = `✏️ プラン ${planNum} の条件を編集中です`;
        if (submitBtn) {
            submitBtn.innerText = `プラン ${planNum} の内容を更新する`;
            submitBtn.classList.add('btn-update-mode');
        }
        if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    } else {
        if (inputPanel) inputPanel.classList.remove('is-editing-mode');
        if (editingBanner) editingBanner.style.display = 'none';
        if (submitBtn) {
            submitBtn.innerText = '＋ 比較プランに追加する';
            submitBtn.classList.remove('btn-update-mode');
        }
        if (cancelBtn) cancelBtn.style.display = 'none';
    }
}

function updateOptionDistance(id, val) {
    if (!selectedOptions[id]) selectedOptions[id] = { distance: 0, times: 0, count: 0 };
    selectedOptions[id].distance = parseFloat(val) || 0;
    refreshOptionHighlight(id);
    updateOptionsBadge();
}

function updateOptionTimes(id, val) {
    if (!selectedOptions[id]) selectedOptions[id] = { distance: 0, times: 0, count: 0 };
    selectedOptions[id].times = parseInt(val) || 0;
    refreshOptionHighlight(id);
    updateOptionsBadge();
}

function updateOptionCount(id, val) {
    if (!selectedOptions[id]) selectedOptions[id] = { distance: 0, times: 0, count: 0 };
    selectedOptions[id].count = parseInt(val) || 0;
    refreshOptionHighlight(id);
    updateOptionsBadge();
}

function refreshOptionHighlight(id) {
    const itemEl = document.getElementById(`opt_item_${id}`);
    if (!itemEl || !appConfig.options) return;
    const opt = appConfig.options.find(o => o.id === id);
    if (!opt) return;
    const st = selectedOptions[id] || { distance: 0, times: 0, count: 0 };
    const hasVal = (opt.unit_type === 'distance') ? (st.distance > 0 && st.times > 0) : (st.count > 0);
    if (hasVal) {
        itemEl.classList.add('has-value');
    } else {
        itemEl.classList.remove('has-value');
    }
}

function updateOptionsBadge() {
    let count = 0;
    if (appConfig.options) {
        appConfig.options.forEach(opt => {
            const st = selectedOptions[opt.id] || { distance: 0, times: 0, count: 0 };
            const unitType = opt.unit_type || 'times';
            if (unitType === 'distance') {
                if (st.distance > 0 && st.times > 0) count++;
            } else {
                if (st.count > 0) count++;
            }
        });
    }
    const optionsBadge = document.getElementById('options-badge');
    if (optionsBadge) optionsBadge.innerText = `選択: ${count}件`;
}

function selectCareLevel(id) {
    selectedCareLevelId = id;
    initUI();
}

function selectBurdenRatio(id) {
    selectedBurdenRatioId = id;
    initUI();
}

function toggleAddition(id) {
    if (!selectedAdditions[id]) {
        selectedAdditions[id] = { active: false, count: 1 };
    }
    selectedAdditions[id].active = !selectedAdditions[id].active;
    initUI();
}

function updateAdditionCount(id, val) {
    if (selectedAdditions[id]) {
        let count = parseInt(val) || 1;
        if (count < 1) count = 1;
        selectedAdditions[id].count = count;
    }
}

function getCurrentFormData() {
    const additions = {};
    if (appConfig.additions) {
        appConfig.additions.forEach(add => {
            const state = selectedAdditions[add.id] || { active: false, count: 1 };
            const inputCount = document.getElementById(`add_count_${add.id}`);
            const count = inputCount ? parseInt(inputCount.value) || state.count : state.count;
            
            additions[add.id] = {
                active: state.active,
                count: count
            };
        });
    }

    const options = {};
    if (appConfig.options) {
        appConfig.options.forEach(opt => {
            const unitType = opt.unit_type || 'times';
            const st = selectedOptions[opt.id] || { distance: 0, times: 0, count: 0 };
            
            if (unitType === 'distance') {
                const distInput = document.getElementById(`opt_dist_${opt.id}`);
                const timesInput = document.getElementById(`opt_times_${opt.id}`);
                options[opt.id] = {
                    distance: distInput ? parseFloat(distInput.value) || 0 : st.distance,
                    times: timesInput ? parseInt(timesInput.value) || 0 : st.times
                };
            } else {
                const input = document.getElementById(`opt_${opt.id}`);
                options[opt.id] = {
                    count: input ? parseInt(input.value) || 0 : st.count
                };
            }
        });
    }

    return { 
        care_level_id: selectedCareLevelId, 
        burden_ratio_id: selectedBurdenRatioId,
        additions, 
        options 
    };
}

function calculateFeeLocally(formData) {
    const careLevels = appConfig.care_levels || [];
    const burdenRatios = appConfig.burden_ratios || [];
    const additionsConfig = appConfig.additions || [];
    const optionsConfig = appConfig.options || [];

    const careLevel = careLevels.find(cl => cl.id === formData.care_level_id) || careLevels[0];
    const rawBaseFeeUnits = careLevel ? careLevel.base_fee : 0;
    const careName = careLevel ? careLevel.name : "";

    const burdenRatio = burdenRatios.find(br => br.id === formData.burden_ratio_id) || burdenRatios[0];
    const burdenRate = burdenRatio ? burdenRatio.rate : 0.1;
    const burdenName = burdenRatio ? burdenRatio.name : "1割";

    const unitPricePerUnit = appConfig.unit_price_per_unit || 10.14;
    const addInputs = formData.additions || {};
    
    let totalInsuranceUnits = rawBaseFeeUnits;
    const fixedAddDetailsUnits = [];
    const percentAdditionsConfig = [];

    additionsConfig.forEach(add => {
        const addState = addInputs[add.id] || { active: false, count: 1 };
        if (addState.active) {
            const unitType = add.unit_type || 'month';
            const count = parseInt(addState.count) || 1;
            
            if (unitType === 'percent') {
                percentAdditionsConfig.push({ name: add.name, percentage: add.unit_price });
            } else {
                let subUnits = 0;
                let detailName = add.name;
                if (unitType === 'days') {
                    subUnits = add.unit_price * count;
                    detailName += ` (${count}日分)`;
                } else if (unitType === 'times') {
                    subUnits = add.unit_price * count;
                    detailName += ` (${count}回)`;
                } else {
                    subUnits = add.unit_price;
                    detailName += ` (月額)`;
                }
                totalInsuranceUnits += subUnits;
                fixedAddDetailsUnits.push({ name: detailName, units: subUnits });
            }
        }
    });

    let totalPercentAddUnits = 0;
    const percentAddDetailsUnits = [];

    percentAdditionsConfig.forEach(item => {
        const pUnits = Math.round(totalInsuranceUnits * (item.percentage / 100.0));
        totalPercentAddUnits += pUnits;
        percentAddDetailsUnits.push({ name: `${item.name} (${item.percentage}%)`, units: pUnits });
    });

    const grandTotalInsuranceUnits = totalInsuranceUnits + totalPercentAddUnits;
    const totalInsuranceRawYen = Math.floor(grandTotalInsuranceUnits * unitPricePerUnit);
    const totalInsuranceCopay = Math.floor(totalInsuranceRawYen * burdenRate);

    const addDetails = [];
    fixedAddDetailsUnits.forEach(item => {
        const itemYen10 = Math.floor(item.units * unitPricePerUnit);
        addDetails.push({
            name: `${item.name} (${item.units}単位)`,
            subtotal: Math.floor(itemYen10 * burdenRate)
        });
    });
    percentAddDetailsUnits.forEach(item => {
        const itemYen10 = Math.floor(item.units * unitPricePerUnit);
        addDetails.push({
            name: item.name,
            subtotal: Math.floor(itemYen10 * burdenRate)
        });
    });

    let optionsTotal = 0;
    const optionsDetail = [];

    const optInputs = formData.options || {};
    optionsConfig.forEach(opt => {
        const optState = optInputs[opt.id] || { distance: 0, times: 0, count: 0 };
        const unitType = opt.unit_type || 'times';

        if (unitType === 'distance') {
            const distanceVal = parseFloat(optState.distance) || 0;
            const timesVal = parseInt(optState.times) || 0;
            if (distanceVal > 0 && timesVal > 0) {
                const subtotal = Math.floor(opt.unit_price * distanceVal * timesVal);
                optionsTotal += subtotal;
                optionsDetail.push({ name: `${opt.name} (${distanceVal}km × ${timesVal}回)`, subtotal });
            }
        } else {
            const count = parseInt(optState.count) || 0;
            if (count > 0) {
                const subtotal = Math.floor(opt.unit_price * count);
                optionsTotal += subtotal;
                optionsDetail.push({ name: `${opt.name} (${count}回)`, subtotal });
            }
        }
    });

    const total = totalInsuranceCopay + optionsTotal;
    const rawBaseYen10 = Math.floor(rawBaseFeeUnits * unitPricePerUnit);
    const baseFeeWithBurden = Math.floor(rawBaseYen10 * burdenRate);

    return {
        facility_name: appConfig.facility_name || "",
        care_name: careName,
        burden_name: burdenName,
        raw_base_fee: rawBaseYen10,
        base_fee: baseFeeWithBurden,
        add_details: addDetails,
        options_detail: optionsDetail,
        options_total: optionsTotal,
        total: total
    };
}

async function saveOrAddComparison() {
    const formData = getCurrentFormData();
    if (!formData.care_level_id) {
        alert('介護度を選択してください。');
        return;
    }

    try {
        let result;
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.calculate_fee === 'function') {
            result = await window.pywebview.api.calculate_fee(formData);
        } else {
            result = calculateFeeLocally(formData);
        }

        if (editingCardId !== null) {
            const targetIndex = comparisonList.findIndex(item => item.id === editingCardId);
            if (targetIndex !== -1) {
                comparisonList[targetIndex] = {
                    id: editingCardId,
                    data: JSON.parse(JSON.stringify(formData)),
                    result: result
                };
            }
            editingCardId = null;
            updateEditModeUI();
            renderComparisonCards();
        } else {
            if (comparisonList.length >= 3) {
                alert('比較できるのは最大3つまでです。既存のプランを「条件変更」するか、不要なカードを削除してください。');
                return;
            }
            comparisonList.push({
                id: Date.now(),
                data: JSON.parse(JSON.stringify(formData)),
                result: result
            });
            renderComparisonCards();
        }
    } catch (e) {
        console.error("計算処理に失敗しました", e);
    }
}

function editCard(id) {
    const targetItem = comparisonList.find(item => item.id === id);
    if (!targetItem) return;

    editingCardId = id;
    const savedData = targetItem.data;

    selectedCareLevelId = savedData.care_level_id;
    selectedBurdenRatioId = savedData.burden_ratio_id;

    selectedAdditions = {};
    if (appConfig.additions) {
        appConfig.additions.forEach(add => {
            const savedAdd = (savedData.additions && savedData.additions[add.id])
                ? savedData.additions[add.id]
                : { active: false, count: add.unit_type === 'days' ? 30 : 1 };
            selectedAdditions[add.id] = {
                active: !!savedAdd.active,
                count: savedAdd.count || (add.unit_type === 'days' ? 30 : 1)
            };
        });
    }

    selectedOptions = {};
    if (appConfig.options) {
        appConfig.options.forEach(opt => {
            const savedOpt = (savedData.options && savedData.options[opt.id])
                ? savedData.options[opt.id]
                : { distance: 0, times: 0, count: 0 };
            selectedOptions[opt.id] = {
                distance: savedOpt.distance || 0,
                times: savedOpt.times || 0,
                count: savedOpt.count || 0
            };
        });
    }

    initUI();
    renderComparisonCards();

    const inputPanel = document.getElementById('input-panel-container');
    if (inputPanel && window.innerWidth <= 960) {
        inputPanel.scrollIntoView({ behavior: 'smooth' });
    }
}

function cancelEdit() {
    editingCardId = null;
    updateEditModeUI();
    renderComparisonCards();
}

function removeCard(id) {
    if (editingCardId === id) {
        editingCardId = null;
        updateEditModeUI();
    }
    comparisonList = comparisonList.filter(item => item.id !== id);
    renderComparisonCards();
}

function renderComparisonCards() {
    const container = document.getElementById('comparison-cards');
    if (!container) return;

    if (comparisonList.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <div class="empty-title">シミュレーション結果がここに表示されます</div>
                <div class="empty-desc">左側のパネルで条件を選択し、「比較プランに追加する」を押してください。<br>（最大3つのプランを色分けして比較・後から編集できます）</div>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    comparisonList.forEach((item, index) => {
        const res = item.result;
        const isEditingThis = (item.id === editingCardId);
        const themeClass = `plan-theme-${(index % 3) + 1}`;
        
        let addHtml = '';
        if (res.add_details && res.add_details.length > 0) {
            addHtml += `<tr class="section-row"><td colspan="2">介護保険 加算項目</td></tr>`;
            res.add_details.forEach(a => {
                addHtml += `<tr><td>${a.name}</td><td>¥${a.subtotal.toLocaleString()}</td></tr>`;
            });
        }

        let optionsHtml = '';
        if (res.options_detail && res.options_detail.length > 0) {
            optionsHtml += `<tr class="section-row"><td colspan="2">自費・オプション項目</td></tr>`;
            res.options_detail.forEach(opt => {
                optionsHtml += `<tr><td>${opt.name}</td><td>¥${opt.subtotal.toLocaleString()}</td></tr>`;
            });
        }

        const cardHtml = `
            <div class="simulation-card ${themeClass} ${isEditingThis ? 'editing-active' : ''}" id="card-${item.id}">
                <div class="card-header">
                    <div class="card-title-group">
                        <span class="plan-badge">
                            <span class="plan-dot"></span>
                            ${isEditingThis ? '編集中 - ' : ''}プラン ${index + 1}
                        </span>
                        <span class="card-title">${res.care_name} / ${res.burden_name}負担</span>
                    </div>
                    <div class="card-header-actions">
                        <button class="edit-card-btn" onclick="editCard(${item.id})" title="このプランの条件を変更する">
                            ${isEditingThis ? '編集中' : '✏️ 条件変更'}
                        </button>
                        <button class="delete-btn" onclick="removeCard(${item.id})" title="削除">×</button>
                    </div>
                </div>
                <table class="summary-table">
                    <tr>
                        <td>基本月額料金 (${res.care_name} / ${res.burden_name})<br><span style="font-size:10.5px; color:var(--text-sub);">(10割総額 ¥${res.raw_base_fee.toLocaleString()})</span></td>
                        <td>¥${res.base_fee.toLocaleString()}</td>
                    </tr>
                    ${addHtml}
                    ${optionsHtml}
                </table>
                <div class="total-box">
                    <div class="total-label">月額目安（税込）</div>
                    <div class="total-amount">¥${res.total.toLocaleString()}</div>
                </div>
                <button class="btn btn-print" onclick="printCard(${item.id})">🖨️ この結果をPDF出力（保存）</button>
            </div>
        `;
        container.innerHTML += cardHtml;
    });
}

function printCard(id) {
    const targetCard = document.getElementById(`card-${id}`);
    if (!targetCard) return;

    if (document.body.classList.contains('is-printing')) return;
    document.body.classList.add('is-printing');

    const facilityName = appConfig.facility_name || '看護小規模多機能居宅介護';
    
    const logoHtml = appConfig.logo 
        ? `<img src="${appConfig.logo}" alt="ロゴ" style="height: 28px; margin-right: 12px; object-fit: contain;" onerror="this.style.display='none';">` 
        : '';

    const printHeader = document.createElement('div');
    printHeader.className = 'dynamic-print-header';
    printHeader.style.cssText = 'display: flex; align-items: center; margin-bottom: 14px; border-bottom: 2px solid #5AC8C2; padding-bottom: 8px;';
    printHeader.innerHTML = `
        ${logoHtml}
        <span style="font-size: 15px; font-weight: bold; color: #3D5258;">${facilityName} 利用料金シミュレーション</span>
    `;

    const printSeal = document.createElement('div');
    printSeal.className = 'dynamic-print-seal';
    printSeal.style.cssText = 'display: flex; flex-direction: column; align-items: flex-end; margin-top: 18px; margin-bottom: 10px; page-break-inside: avoid;';
    printSeal.innerHTML = `
        <div style="box-sizing: border-box; border: 1px solid #3D5258; width: 68px; background: #F5FBFB; padding: 3px 0; text-align: center; font-size: 10px; font-weight: bold;">担当者</div>
        <div style="box-sizing: border-box; border: 1px solid #3D5258; border-top: none; width: 68px; height: 48px;"></div>
    `;

    targetCard.insertBefore(printHeader, targetCard.firstChild);
    targetCard.appendChild(printSeal);
    targetCard.classList.add('printing');

    const allCards = document.querySelectorAll('.simulation-card');
    allCards.forEach(card => {
        if (card.id !== `card-${id}`) {
            card.style.display = 'none';
        }
    });

    let cleanedUp = false;
    const cleanupPrint = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        window.removeEventListener('afterprint', cleanupPrint);

        allCards.forEach(card => {
            if (card.id !== `card-${id}`) {
                card.style.display = '';
            }
        });

        targetCard.classList.remove('printing');
        if (printHeader.parentNode) printHeader.remove();
        if (printSeal.parentNode) printSeal.remove();
        document.body.classList.remove('is-printing');
    };

    window.addEventListener('afterprint', cleanupPrint);

    requestAnimationFrame(() => {
        setTimeout(() => {
            window.print();
            window.addEventListener('focus', () => setTimeout(cleanupPrint, 500), { once: true });
        }, 250);
    });
}

function resetForm() {
    editingCardId = null;
    if (appConfig.care_levels && appConfig.care_levels.length > 0) {
        selectedCareLevelId = appConfig.care_levels[0].id;
    }
    if (appConfig.burden_ratios && appConfig.burden_ratios.length > 0) {
        selectedBurdenRatioId = appConfig.burden_ratios[0].id;
    }
    selectedAdditions = {};
    if (appConfig.additions) {
        appConfig.additions.forEach(add => {
            selectedAdditions[add.id] = { active: false, count: add.unit_type === 'days' ? 30 : 1 };
        });
    }
    selectedOptions = {};
    if (appConfig.options) {
        appConfig.options.forEach(opt => {
            selectedOptions[opt.id] = { distance: 0, times: 0, count: 0 };
        });
    }
    initUI();
    renderComparisonCards();
}

function openAdminAuth() {
    document.getElementById('admin-pass-input').value = '';
    document.getElementById('auth-modal').style.display = 'flex';
}

function closeAuthModal() {
    document.getElementById('auth-modal').style.display = 'none';
}

function verifyAdmin() {
    const pass = document.getElementById('admin-pass-input').value;
    const correctPass = appConfig.admin_password || "admin";
    if (pass === correctPass) {
        closeAuthModal();
        openConfigModal();
    } else {
        alert('パスワードが違います。');
    }
}

function openConfigModal() {
    document.getElementById('edit-facility-name').value = appConfig.facility_name || '';
    
    const passInput = document.getElementById('edit-admin-password');
    if (passInput) passInput.value = '';

    const unitPriceInput = document.getElementById('edit-unit-price-per-unit');
    if (unitPriceInput) {
        unitPriceInput.value = appConfig.unit_price_per_unit || 10.14;
    }

    uploadedLogoBase64 = null;
    isLogoDeleted = false;
    const logoPreview = document.getElementById('edit-logo-preview');
    const logoFileInput = document.getElementById('edit-logo-file');
    if (logoFileInput) logoFileInput.value = '';

    if (logoPreview) {
        if (appConfig.logo) {
            logoPreview.src = appConfig.logo;
            logoPreview.style.display = 'block';
        } else {
            logoPreview.src = '';
            logoPreview.style.display = 'none';
        }
    }

    const burdenContainer = document.getElementById('edit-burden-ratios-container');
    burdenContainer.innerHTML = '';
    if (appConfig.burden_ratios) {
        appConfig.burden_ratios.forEach((br) => {
            burdenContainer.innerHTML += `
                <div class="edit-row br-row" data-id="${br.id}">
                    <span style="text-align:center; color:#94A3B8;">-</span>
                    <input type="text" class="br-name" value="${br.name}">
                    <input type="number" step="0.05" class="br-rate" value="${br.rate}">
                    <span style="font-size:11px; color:var(--text-sub);">割合(例:0.1)</span>
                    <span></span>
                </div>
            `;
        });
    }

    const careContainer = document.getElementById('edit-care-levels-container');
    careContainer.innerHTML = '';
    if (appConfig.care_levels) {
        appConfig.care_levels.forEach((cl) => {
            careContainer.innerHTML += `
                <div class="edit-row cl-row" data-id="${cl.id}">
                    <span style="text-align:center; color:#94A3B8;">-</span>
                    <input type="text" class="cl-name" value="${cl.name}">
                    <input type="number" class="cl-fee" value="${cl.base_fee}">
                    <span style="font-size:11px; color:var(--text-sub);">単位</span>
                    <span></span>
                </div>
            `;
        });
    }

    renderEditAdditions();
    renderEditOptions();
    
    document.getElementById('config-modal').style.display = 'flex';
}

function previewLogoFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        uploadedLogoBase64 = e.target.result;
        isLogoDeleted = false;
        const preview = document.getElementById('edit-logo-preview');
        if (preview) {
            preview.src = uploadedLogoBase64;
            preview.style.display = 'block';
        }
    };
    reader.readAsDataURL(file);
}

function removeLogo() {
    uploadedLogoBase64 = null;
    isLogoDeleted = true;
    
    const logoFileInput = document.getElementById('edit-logo-file');
    if (logoFileInput) logoFileInput.value = '';

    const preview = document.getElementById('edit-logo-preview');
    if (preview) {
        preview.src = '';
        preview.style.display = 'none';
    }
}

function renderEditAdditions() {
    const addContainer = document.getElementById('edit-additions-container');
    addContainer.innerHTML = '';
    if (appConfig.additions) {
        appConfig.additions.forEach((add) => {
            addContainer.appendChild(createSortableRow('add', add.id, add.name, add.unit_price, add.unit_type || 'month'));
        });
    }
}

function addAdditionRow() {
    const addContainer = document.getElementById('edit-additions-container');
    const newId = 'add_' + Date.now();
    addContainer.appendChild(createSortableRow('add', newId, '', 0, 'month'));
}

function renderEditOptions() {
    const optContainer = document.getElementById('edit-options-container');
    optContainer.innerHTML = '';
    if (appConfig.options) {
        appConfig.options.forEach((opt) => {
            optContainer.appendChild(createSortableRow('opt', opt.id, opt.name, opt.unit_price, opt.unit_type || 'times'));
        });
    }
}

function addOptionRow() {
    const optContainer = document.getElementById('edit-options-container');
    const newId = 'opt_' + Date.now();
    optContainer.appendChild(createSortableRow('opt', newId, '', 0, 'times'));
}

function createSortableRow(type, id, name, price, unitType) {
    const row = document.createElement('div');
    row.className = `edit-row ${type}-row`;
    row.setAttribute('data-id', id);

    let unitSelectHtml = '';
    let placeholderText = '単位数/％';
    if (type === 'add') {
        unitSelectHtml = `
            <select class="add-unit-type">
                <option value="month" ${unitType === 'month' ? 'selected' : ''}>月額固定 (単位)</option>
                <option value="days" ${unitType === 'days' ? 'selected' : ''}>日単位 (/日)</option>
                <option value="times" ${unitType === 'times' ? 'selected' : ''}>回単位 (/回)</option>
                <option value="percent" ${unitType === 'percent' ? 'selected' : ''}>％単位 (％)</option>
            </select>
        `;
    } else {
        placeholderText = '単価(円)';
        unitSelectHtml = `
            <select class="opt-unit-type">
                <option value="times" ${unitType === 'times' ? 'selected' : ''}>回・日単位 (/回)</option>
                <option value="distance" ${unitType === 'distance' ? 'selected' : ''}>距離単位 (/km×回)</option>
            </select>
        `;
    }

    row.innerHTML = `
        <div class="drag-handle" title="ここをドラッグして並び替え">☰</div>
        <input type="text" class="${type}-name" value="${name}" placeholder="項目名">
        <input type="number" step="any" class="${type}-price" value="${price}" placeholder="${placeholderText}">
        ${unitSelectHtml}
        <button class="delete-row-btn" onclick="this.parentElement.remove()">×</button>
    `;

    const handle = row.querySelector('.drag-handle');
    handle.addEventListener('mousedown', () => row.setAttribute('draggable', 'true'));
    handle.addEventListener('mouseup', () => row.setAttribute('draggable', 'false'));

    row.addEventListener('dragstart', (e) => {
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        row.setAttribute('draggable', 'false');
    });

    row.addEventListener('dragover', (e) => {
        e.preventDefault();
        const container = row.parentNode;
        const draggingRow = container.querySelector('.dragging');
        if (!draggingRow || draggingRow === row) return;

        const rect = row.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        
        if (e.clientY < midpoint) {
            container.insertBefore(draggingRow, row);
        } else {
            container.insertBefore(draggingRow, row.nextSibling);
        }
    });

    return row;
}

function closeConfigModal() {
    document.getElementById('config-modal').style.display = 'none';
}

async function saveNewConfig() {
    const newConfig = { ...appConfig };
    newConfig.facility_name = document.getElementById('edit-facility-name').value;

    const passInput = document.getElementById('edit-admin-password');
    if (passInput && passInput.value.trim() !== '') {
        newConfig.admin_password = passInput.value.trim();
    } else if (!newConfig.admin_password) {
        newConfig.admin_password = "admin";
    }

    const unitPriceInput = document.getElementById('edit-unit-price-per-unit');
    newConfig.unit_price_per_unit = unitPriceInput ? (parseFloat(unitPriceInput.value) || 10.14) : 10.14;

    if (isLogoDeleted) {
        newConfig.logo = "";
    } else if (uploadedLogoBase64 !== null) {
        newConfig.logo = uploadedLogoBase64;
    }

    const brRows = document.querySelectorAll('#edit-burden-ratios-container .br-row');
    const newBurdenRatios = [];
    brRows.forEach(row => {
        const id = row.getAttribute('data-id') || ('ratio_' + Date.now());
        const name = row.querySelector('.br-name').value;
        const rate = parseFloat(row.querySelector('.br-rate').value) || 0.1;
        if (name) {
            newBurdenRatios.push({ id, name, rate });
        }
    });
    newConfig.burden_ratios = newBurdenRatios;

    const clRows = document.querySelectorAll('#edit-care-levels-container .cl-row');
    const newCareLevels = [];
    clRows.forEach(row => {
        const id = row.getAttribute('data-id') || ('level_' + Date.now());
        const name = row.querySelector('.cl-name').value;
        const base_fee = parseInt(row.querySelector('.cl-fee').value) || 0;
        if (name) {
            newCareLevels.push({ id, name, base_fee });
        }
    });
    newConfig.care_levels = newCareLevels;

    const addRows = document.querySelectorAll('#edit-additions-container .add-row');
    const newAdditions = [];
    addRows.forEach(row => {
        const id = row.getAttribute('data-id') || ('add_' + Date.now());
        const name = row.querySelector('.add-name').value;
        const unit_price = parseFloat(row.querySelector('.add-price').value) || 0;
        const unitSelect = row.querySelector('.add-unit-type');
        const unit_type = unitSelect ? unitSelect.value : 'month';
        if (name) {
            newAdditions.push({ id, name, unit_price, unit_type });
        }
    });
    newConfig.additions = newAdditions;

    const optRows = document.querySelectorAll('#edit-options-container .opt-row');
    const newOptions = [];
    optRows.forEach(row => {
        const id = row.getAttribute('data-id') || ('opt_' + Date.now());
        const name = row.querySelector('.opt-name').value;
        const unit_price = parseFloat(row.querySelector('.opt-price').value) || 0;
        const unitSelect = row.querySelector('.opt-unit-type');
        const unit_type = unitSelect ? unitSelect.value : 'times';
        if (name) {
            newOptions.push({ id, name, unit_price, unit_type });
        }
    });
    newConfig.options = newOptions;

    const res = await window.pywebview.api.update_config(newConfig);
    if (res.success) {
        alert(res.message);
        closeConfigModal();
        uploadedLogoBase64 = null;
        isLogoDeleted = false;
        await loadAppData();
        for (let i = 0; i < comparisonList.length; i++) {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.calculate_fee === 'function') {
                comparisonList[i].result = await window.pywebview.api.calculate_fee(comparisonList[i].data);
            } else {
                comparisonList[i].result = calculateFeeLocally(comparisonList[i].data);
            }
        }
        renderComparisonCards();
    } else {
        alert('保存に失敗しました: ' + res.message);
    }
}