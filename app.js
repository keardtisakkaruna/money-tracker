const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwFfGfF-diWc8gEZ9Z_suegjq0ajOqpKcZs-H0Nc5jBhTEXoKxXOUb5eHoPrtXtxR08/exec";
  let currentAccount = 'main';
  let appData = {
    summary: { income: 0, expense: 0, balance: 0, cycleText: "ยอดคงเหลือ" },
    categories: { income: [], expense: [] },
    recentTransactions: [],
    billStatus: []
  };

  function getTodayLocalStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
  }

  function isGasEnvironment() {
    return typeof google !== 'undefined' && google.script && google.script.run;
  }

  // Unified API Caller (Works on both GitHub Pages via fetch and inside GAS via google.script.run)
  function callBackend(action, payload, onSuccess, onFailure) {
    const errHandler = onFailure || onError;
    if (isGasEnvironment()) {
      const runner = google.script.run.withSuccessHandler(onSuccess).withFailureHandler(errHandler);
      if (action === 'getInitialData') return runner.getInitialData(payload.account);
      if (action === 'getDashboardData') return runner.getDashboardData(payload.start, payload.end, payload.account);
      if (action === 'addTransaction') return runner.addTransaction(payload.formData, payload.account);
      if (action === 'deleteTransaction') return runner.deleteTransaction(payload.id, payload.account);
      if (action === 'saveSettings') return runner.saveSettings(payload.startDate, payload.endDate);
      if (action === 'analyzeSlipWithGemini') return runner.analyzeSlipWithGemini(payload.base64Data, payload.mimeType);
    } else {
      fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, ...payload })
      })
        .then(res => res.json())
        .then(data => onSuccess(data))
        .catch(err => errHandler(err));
    }
  }

  function getCacheKey(acc) {
    return 'money_tracker_v2_' + acc;
  }

  function loadInitialDataWithCache(acc, showLoaderIfNoCache = true) {
    let hadCache = false;
    try {
      const cached = localStorage.getItem(getCacheKey(acc));
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.summary) {
          hadCache = true;
          onDataLoaded(parsed, true);
        }
      }
    } catch (e) {}

    if (!hadCache && showLoaderIfNoCache) {
      showFullLoader("กำลังโหลดข้อมูล...");
    }

    callBackend('getInitialData', { account: acc }, (freshData) => {
      if (freshData && freshData.summary) {
        try {
          localStorage.setItem(getCacheKey(acc), JSON.stringify(freshData));
        } catch (e) {}
        onDataLoaded(freshData, false);
      } else {
        hideFullLoader();
      }
    }, onError);
  }

  // On Load
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('date').value = getTodayLocalStr();
    loadInitialDataWithCache(currentAccount, true);
  });

  function switchAccount(acc) {
    if (currentAccount === acc) return;
    currentAccount = acc;
    
    const accounts = ['main', 'kept', 'kplus'];
    accounts.forEach(a => {
      const btn = document.getElementById('btn-acc-' + a);
      if (!btn) return;
      const isActive = (a === acc);
      btn.classList.toggle('active', isActive);
      btn.classList.toggle('kplus-active', isActive && acc === 'kplus');
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const subtitleEl = document.getElementById('account-subtitle');
    const badgeIconEl = document.getElementById('account-badge-icon');
    if (acc === 'main') {
      subtitleEl.innerText = "จัดการการเงินบัญชีหลักของคุณ";
      badgeIconEl.innerHTML = '<i class="fa-solid fa-wallet" aria-hidden="true"></i>';
    } else if (acc === 'kept') {
      subtitleEl.innerText = "กระปุกออมเงินสะสม (Kept)";
      badgeIconEl.innerHTML = '<i class="fa-solid fa-piggy-bank" aria-hidden="true"></i>';
    } else if (acc === 'kplus') {
      subtitleEl.innerText = "กระเป๋ารายได้เสริม (K PLUS)";
      badgeIconEl.innerHTML = '<i class="fa-solid fa-building-columns" aria-hidden="true"></i>';
    }

    switchTab('home');
    loadInitialDataWithCache(currentAccount, true);
  }

  function onDataLoaded(data, isFromCache = false) {
    appData = data;
    updateDashboard();
    renderTransactions();
    
    if (appData.summary.startDate) document.getElementById('dash-start').value = appData.summary.startDate;
    if (appData.summary.endDate) document.getElementById('dash-end').value = appData.summary.endDate;
    
    initDashboardCycles();
    hideFullLoader();
  }

  function onError(err) {
    showToast("เกิดข้อผิดพลาด: " + err);
    hideFullLoader();
  }

  function formatMoneyValue(amount) {
    return '฿' + (parseFloat(amount) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function updateDashboard() {
    const summary = appData.summary;

    document.getElementById('balance-title').innerText = summary.cycleText || "ยอดคงเหลือ";
    document.getElementById('balance-amount').innerText = formatMoneyValue(summary.balance);
    document.getElementById('income-amount').innerText = formatMoneyValue(summary.income);
    document.getElementById('expense-amount').innerText = formatMoneyValue(summary.expense);
    
    const useBalBtn = document.getElementById('btn-calc-use-bal');
    if (useBalBtn) {
      const balNum = (parseFloat(summary.balance) || 0).toFixed(2).replace(/\.00$/, '');
      useBalBtn.innerText = `ตั้งลบจากยอดในระบบ (${balNum}-)`;
    }

    // Hide/Show UI based on account
    document.querySelector('.settings-btn').style.display = 'none';
    if (currentAccount === 'kept' || currentAccount === 'kplus') {
      document.getElementById('bill-tracker-container').style.display = 'none';
      if (document.getElementById('dash-cycle-card')) document.getElementById('dash-cycle-card').style.display = 'none';
    } else {
      document.getElementById('bill-tracker-container').style.display = 'block';
      if (document.getElementById('dash-cycle-card')) document.getElementById('dash-cycle-card').style.display = 'block';
    }
    
    // Render Bill Tracker
    const billListEl = document.getElementById('bill-tracker-list');
    billListEl.innerHTML = '';
    
    if (appData.billStatus && appData.billStatus.length > 0) {
      const sortedBills = [...appData.billStatus].sort((a, b) => (a.paid === b.paid) ? 0 : a.paid ? 1 : -1);
      
      sortedBills.forEach(bill => {
        const chip = document.createElement('div');
        chip.className = `bill-chip ${bill.paid ? 'paid' : 'unpaid'}`;
        
        const icon = bill.paid ? '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>' : '<i class="fa-regular fa-circle" aria-hidden="true"></i>';
        const amountText = bill.paid ? ` (${formatMoneyValue(bill.amount)})` : '';
        
        chip.innerHTML = `${icon} ${bill.name}${amountText}`;
        billListEl.appendChild(chip);
      });
    } else {
      billListEl.innerHTML = '<div style="font-size: 13px; color: var(--text-muted);">ไม่มีรายการบิล</div>';
    }

    renderChart(appData.summary.categorySummary);
  }

  let expenseChart = null;
  function renderChart(categoryData) {
    const chartCard = document.getElementById('chart-card');
    const labels = Object.keys(categoryData || {});
    const data = Object.values(categoryData || {});
    
    if (data.length === 0 || data.reduce((a, b) => a + b, 0) === 0) {
      chartCard.style.display = 'none';
      return;
    }
    
    chartCard.style.display = 'block';
    const ctx = document.getElementById('expenseChart').getContext('2d');
    
    if (expenseChart) {
      expenseChart.destroy();
    }
    
    const bgColors = ['#ffb3c6', '#60a5fa', '#fbcfe8', '#bae6fd', '#fb7185', '#38bdf8', '#f472b6'];
    const cardBgColor = getComputedStyle(document.documentElement).getPropertyValue('--card-bg').trim();

    expenseChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: bgColors,
          borderWidth: 2,
          borderColor: cardBgColor
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  function renderTransactions() {
    const list = document.getElementById('transaction-list');
    
    if (!appData.recentTransactions || appData.recentTransactions.length === 0) {
      list.innerHTML = '<div class="empty-state">ไม่มีรายการในรอบนี้</div>';
      return;
    }

    list.innerHTML = '';
    
    appData.recentTransactions.forEach(tx => {
      const isIncome = tx.type === 'รายรับ';
      const icon = isIncome
        ? '<i class="fa-solid fa-arrow-down" aria-hidden="true" style="color:var(--success)"></i>'
        : '<i class="fa-solid fa-arrow-up" aria-hidden="true" style="color:var(--danger)"></i>';
      const amountClass = isIncome ? 'income' : 'expense';
      const amountPrefix = isIncome ? '+' : '-';
      
      const formatMoney = (parseFloat(tx.amount) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const div = document.createElement('div');
      div.className = 'transaction-item';
      div.innerHTML = `
        <div class="tx-left">
          <div class="tx-icon">${icon}</div>
          <div class="tx-details">
            <h4>${tx.category}</h4>
            <p>${tx.note || tx.type}</p>
          </div>
        </div>
        <div class="tx-right">
          <div>
            <div class="tx-amount ${amountClass}">${amountPrefix} ฿${formatMoney}</div>
            <div class="tx-date">${tx.date}</div>
          </div>
          <button type="button" class="delete-icon-btn" onclick="deleteTx('${tx.id}')" aria-label="ลบรายการ ${tx.category}">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        </div>
      `;
      list.appendChild(div);
    });
  }

  function deleteTx(id) {
    if (!confirm("ต้องการลบรายการนี้ใช่หรือไม่?")) return;
    
    showFullLoader("กำลังลบรายการ...");
    callBackend('deleteTransaction', { id: id, account: currentAccount }, (res) => {
      if (res && res.success) {
        showToast(res.message);
        loadInitialDataWithCache(currentAccount, false);
      } else {
        hideFullLoader();
        showToast("ลบไม่สำเร็จ: " + (res ? res.message : ""));
      }
    }, onError);
  }

  // ==========================================
  // Inline Calculator & Smart Balance Adjuster
  // ==========================================
  function safeEvaluateMath(exprStr) {
    if (!exprStr) return NaN;
    const normalized = String(exprStr)
      .replace(/,/g, '')
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .replace(/\s+/g, '');
    if (!/^[0-9+\-*/.()]+$/.test(normalized)) return NaN;
    try {
      const result = Function('"use strict"; return (' + normalized + ')')();
      return (typeof result === 'number' && isFinite(result)) ? Math.round(result * 100) / 100 : NaN;
    } catch (e) {
      return NaN;
    }
  }

  function useBalanceMinusInCalc() {
    const bal = parseFloat(appData.summary.balance) || 0;
    const balClean = bal.toFixed(2).replace(/\.00$/, '');
    const calcInput = document.getElementById('inline-calc-input');
    calcInput.value = balClean + '-';
    calcInput.focus();
  }

  function appendCalcOp(op) {
    const calcInput = document.getElementById('inline-calc-input');
    if (!calcInput.value && document.getElementById('amount').value) {
      calcInput.value = document.getElementById('amount').value;
    }
    calcInput.value += op;
    calcInput.focus();
  }

  function clearInlineCalc() {
    document.getElementById('inline-calc-input').value = '';
  }

  function evaluateInlineCalc() {
    const calcInput = document.getElementById('inline-calc-input');
    const val = safeEvaluateMath(calcInput.value);
    if (isNaN(val)) {
      showToast("รูปแบบตัวเลขไม่ถูกต้อง เช่น 3500-2300");
      return;
    }
    const finalAmount = Math.abs(val);
    document.getElementById('amount').value = finalAmount.toFixed(2).replace(/\.00$/, '');
    showToast(`คำนวณสำเร็จ: ฿${finalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  // Smart Balance Adjuster Modal
  let currentAdjustDiff = 0; // actual - sysBalance

  function openAdjustModal() {
    const sysBal = parseFloat(appData.summary.balance) || 0;
    document.getElementById('adjust-sys-balance').innerText = formatMoneyValue(sysBal);
    document.getElementById('actual-balance-input').value = '';
    document.getElementById('adjust-note').value = 'รวบยอดตามเงินจริงในบัญชี';
    document.getElementById('adjust-diff-result').style.display = 'none';
    document.getElementById('adjust-submit-btn').disabled = true;
    populateSelectWithCategories(document.getElementById('adjust-category'), appData.categories.expense, 'กิน');
    document.getElementById('adjust-modal').classList.add('active');
    setTimeout(() => document.getElementById('actual-balance-input').focus(), 150);
  }

  function closeAdjustModal() {
    document.getElementById('adjust-modal').classList.remove('active');
  }

  function populateSelectWithCategories(selectEl, cats, preferredValue) {
    selectEl.innerHTML = '';
    (cats || []).forEach(cat => {
      if (typeof cat === 'object' && cat.group) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = cat.group;
        cat.items.forEach(item => {
          const opt = document.createElement('option');
          opt.value = item;
          opt.innerText = item;
          optgroup.appendChild(opt);
        });
        selectEl.appendChild(optgroup);
      } else {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        selectEl.appendChild(opt);
      }
    });
    if (preferredValue) {
      for (let i = 0; i < selectEl.options.length; i++) {
        if (selectEl.options[i].value === preferredValue) {
          selectEl.selectedIndex = i;
          break;
        }
      }
    }
  }

  function updateAdjustDiffPreview() {
    const rawVal = document.getElementById('actual-balance-input').value;
    const resultBox = document.getElementById('adjust-diff-result');
    const submitBtn = document.getElementById('adjust-submit-btn');
    const catSelect = document.getElementById('adjust-category');

    if (rawVal === '' || isNaN(parseFloat(rawVal))) {
      resultBox.style.display = 'none';
      submitBtn.disabled = true;
      return;
    }

    const sysBal = parseFloat(appData.summary.balance) || 0;
    const actualBal = parseFloat(rawVal);
    const diff = Math.round((actualBal - sysBal) * 100) / 100;
    currentAdjustDiff = diff;

    resultBox.style.display = 'block';
    const labelEl = document.getElementById('adjust-diff-label');
    const amountEl = document.getElementById('adjust-diff-amount');
    const formulaEl = document.getElementById('adjust-diff-formula');

    if (diff === 0) {
      labelEl.innerText = "ยอดเงินในระบบตรงกับในบัญชีพอดีเป๊ะ!";
      amountEl.innerText = "฿0.00";
      amountEl.style.color = "var(--text-muted)";
      formulaEl.innerText = "ไม่ต้องบันทึกรายการปรับยอด";
      submitBtn.disabled = true;
    } else if (diff < 0) {
      const absDiff = Math.abs(diff);
      labelEl.innerText = "ใช้จ่ายออกไป (จะบันทึกเป็น รายจ่าย)";
      amountEl.innerText = "- " + formatMoneyValue(absDiff);
      amountEl.style.color = "var(--danger)";
      formulaEl.innerText = `ในระบบ ${formatMoneyValue(sysBal)} − ในบัญชีจริง ${formatMoneyValue(actualBal)}`;
      populateSelectWithCategories(catSelect, appData.categories.expense, 'กิน');
      submitBtn.className = "submit-btn expense-mode";
      submitBtn.innerHTML = `บันทึกรายจ่าย ${formatMoneyValue(absDiff)} <i class="fa-solid fa-check" aria-hidden="true"></i>`;
      submitBtn.disabled = false;
    } else {
      labelEl.innerText = "มีเงินเข้าเพิ่ม (จะบันทึกเป็น รายรับ)";
      amountEl.innerText = "+ " + formatMoneyValue(diff);
      amountEl.style.color = "var(--success)";
      formulaEl.innerText = `ในบัญชีจริง ${formatMoneyValue(actualBal)} − ในระบบ ${formatMoneyValue(sysBal)}`;
      const defaultIncCat = currentAccount === 'kplus' ? 'รายได้เสริม' : 'ปรับยอดบัญชี';
      populateSelectWithCategories(catSelect, appData.categories.income, defaultIncCat);
      submitBtn.className = "submit-btn income-mode";
      submitBtn.innerHTML = `บันทึกรายรับ ${formatMoneyValue(diff)} <i class="fa-solid fa-check" aria-hidden="true"></i>`;
      submitBtn.disabled = false;
    }
  }

  function submitAdjustBalance(event) {
    event.preventDefault();
    if (currentAdjustDiff === 0) return;

    const btn = document.getElementById('adjust-submit-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> กำลังบันทึก...';
    btn.disabled = true;

    const isExpense = currentAdjustDiff < 0;
    const formData = {
      type: isExpense ? 'รายจ่าย' : 'รายรับ',
      amount: Math.abs(currentAdjustDiff).toFixed(2),
      date: getTodayLocalStr(),
      category: document.getElementById('adjust-category').value,
      note: document.getElementById('adjust-note').value || 'รวบยอดตามเงินจริงในบัญชี'
    };

    callBackend('addTransaction', { formData: formData, account: currentAccount }, (res) => {
      if (res && res.success) {
        showToast("ปรับยอดคงเหลือเรียบร้อยแล้ว!");
        closeAdjustModal();
        loadInitialDataWithCache(currentAccount, false);
      } else {
        showToast("เกิดข้อผิดพลาด: " + (res ? res.message : ""));
      }
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, (err) => {
      showToast("เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว");
      btn.innerHTML = originalText;
      btn.disabled = false;
    });
  }

  // UI Interactions
  function showForm(type) {
    const isExpense = type === 'expense';
    const typeLabel = isExpense ? 'รายจ่าย' : 'รายรับ';
    
    document.getElementById('form-type').value = typeLabel;
    document.getElementById('form-title').innerText = `เพิ่ม${typeLabel}`;
    
    const btn = document.getElementById('submit-btn');
    btn.className = `submit-btn ${type}-mode`;
    
    // Reset form
    document.getElementById('amount').value = '';
    document.getElementById('inline-calc-input').value = '';
    document.getElementById('date').value = getTodayLocalStr();
    document.getElementById('note').value = '';
    document.getElementById('file-data').value = '';
    document.getElementById('file-name').value = '';
    document.getElementById('mime-type').value = '';
    document.getElementById('ai-status').classList.add('hidden');
    
    const preferredCat = (!isExpense && currentAccount === 'kplus') ? 'รายได้เสริม' : null;
    populateSelectWithCategories(
      document.getElementById('category'),
      isExpense ? appData.categories.expense : appData.categories.income,
      preferredCat
    );
    
    document.getElementById('form-modal').classList.add('active');
  }

  function closeForm() {
    document.getElementById('form-modal').classList.remove('active');
  }

  // Settings
  function showSettings() {
    if (appData.summary.startDate) document.getElementById('cycle-start').value = appData.summary.startDate;
    if (appData.summary.endDate) document.getElementById('cycle-end').value = appData.summary.endDate;
    document.getElementById('settings-modal').classList.add('active');
  }

  function handleCycleStartChange() {
    const startVal = document.getElementById('cycle-start').value;
    if (!startVal) return;
    const sDate = new Date(startVal + "T00:00:00");
    const eDate = new Date(sDate.getFullYear(), sDate.getMonth() + 1, sDate.getDate() - 1);
    const eVal = eDate.getFullYear() + "-" + String(eDate.getMonth() + 1).padStart(2, '0') + "-" + String(eDate.getDate()).padStart(2, '0');
    document.getElementById('cycle-end').value = eVal;
  }

  function closeSettings() {
    document.getElementById('settings-modal').classList.remove('active');
  }

  function submitSettings(event) {
    event.preventDefault();
    const btn = document.getElementById('settings-submit-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> กำลังบันทึก...';
    btn.disabled = true;

    const start = document.getElementById('cycle-start').value;
    const end = document.getElementById('cycle-end').value;

    if (start >= end) {
      showToast("วันสิ้นสุดรอบบิลต้องมากกว่าวันเริ่มต้น");
      btn.innerHTML = originalText;
      btn.disabled = false;
      return;
    }

    callBackend('saveSettings', { startDate: start, endDate: end }, (res) => {
      if (res && res.success) {
        showToast(res.message);
        closeSettings();
        loadInitialDataWithCache(currentAccount, true);
      } else {
        showToast("ตั้งค่าไม่สำเร็จ: " + (res ? res.message : ""));
      }
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, () => {
      showToast("เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว");
      btn.innerHTML = originalText;
      btn.disabled = false;
    });
  }

  function triggerFileInput() {
    document.getElementById('slip-upload').click();
  }

  function handleSlipUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showFullLoader("กำลังบีบอัดภาพและให้ AI วิเคราะห์...");

    compressImage(file, 800, (base64Data) => {
      callBackend('analyzeSlipWithGemini', { base64Data: base64Data, mimeType: "image/jpeg" }, onAiSuccess, onError);
    });
    
    event.target.value = '';
  }

  function compressImage(file, maxDim, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        let width = img.width;
        let height = img.height;
        
        if (width > height && width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        } else if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        callback(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function onAiSuccess(response) {
    hideFullLoader();
    if (response && response.success) {
      const data = response.data;
      const type = data.type === 'รายรับ' ? 'income' : 'expense';
      showForm(type);
      
      if (data.amount) document.getElementById('amount').value = data.amount;
      if (data.note) document.getElementById('note').value = data.note;
      if (data.date) {
        try { document.getElementById('date').value = data.date; } catch (e) {}
      }
      
      const catSelect = document.getElementById('category');
      let found = false;
      for (let i = 0; i < catSelect.options.length; i++) {
        if (catSelect.options[i].value === data.category) {
          catSelect.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found && data.category) {
        const opt = document.createElement('option');
        opt.value = data.category;
        opt.innerText = data.category;
        catSelect.appendChild(opt);
        catSelect.value = data.category;
      }
      
      document.getElementById('ai-status').classList.remove('hidden');
      showToast("ดึงข้อมูลจากสลิปสำเร็จ");
    } else {
      showToast("AI วิเคราะห์ไม่สำเร็จ: " + (response ? response.message : ""));
    }
  }

  function submitForm(event) {
    event.preventDefault();
    
    // If user typed in inline calculator but forgot to press '=', auto-evaluate if amount is empty
    const amountEl = document.getElementById('amount');
    const calcVal = document.getElementById('inline-calc-input').value;
    if (!amountEl.value && calcVal) {
      const evaluated = safeEvaluateMath(calcVal);
      if (!isNaN(evaluated)) {
        amountEl.value = Math.abs(evaluated).toFixed(2);
      }
    }

    const btn = document.getElementById('submit-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> กำลังบันทึก...';
    btn.disabled = true;

    const formData = {
      type: document.getElementById('form-type').value,
      amount: amountEl.value,
      date: document.getElementById('date').value,
      category: document.getElementById('category').value,
      note: document.getElementById('note').value
    };

    callBackend('addTransaction', { formData: formData, account: currentAccount }, (res) => {
      if (res && res.success) {
        showToast(res.message);
        closeForm();
        loadInitialDataWithCache(currentAccount, false);
      } else {
        showToast("เกิดข้อผิดพลาด: " + (res ? res.message : ""));
      }
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, () => {
      showToast("เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว");
      btn.innerHTML = originalText;
      btn.disabled = false;
    });
  }

  // Utilities
  function showToast(msg) {
    const oldToast = document.querySelector('.toast');
    if (oldToast) oldToast.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast show';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerText = msg;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function showFullLoader(text) {
    document.getElementById('loader-text').innerText = text;
    const loader = document.getElementById('full-loader');
    loader.style.display = 'flex';
    setTimeout(() => loader.style.opacity = '1', 10);
  }

  function hideFullLoader() {
    const loader = document.getElementById('full-loader');
    loader.style.opacity = '0';
    setTimeout(() => loader.style.display = 'none', 250);
  }

  // ==========================================
  // Dashboard & Navigation Logic
  // ==========================================
  function switchTab(tabId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById(tabId + '-view').classList.add('active');
    document.getElementById('nav-' + tabId).classList.add('active');
    
    if (tabId === 'dashboard') {
      loadDashboard();
    }
  }

  let dashChartInstance = null;
  let currentDashboardTransactions = [];
  let currentDashboardSummary = null;

  function initDashboardCycles() {
    const select = document.getElementById('dash-cycle-select');
    if (!select) return;
    select.innerHTML = '';
    
    const currentStart = appData.summary.startDate;
    const currentEnd = appData.summary.endDate;
    
    if (!currentStart || !currentEnd) return;
    
    const thMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    
    const cS = new Date(currentStart + "T00:00:00");
    const cE = new Date(currentEnd + "T00:00:00");
    const cLabel = currentEnd === "2099-12-31"
      ? `เริ่ม ${cS.getDate()} ${thMonths[cS.getMonth()]} - ปัจจุบัน`
      : `${cS.getDate()} ${thMonths[cS.getMonth()]} - ${cE.getDate()} ${thMonths[cE.getMonth()]}`;
    
    let opt = document.createElement('option');
    opt.value = `${currentStart}|${currentEnd}`;
    opt.innerText = `รอบปัจจุบัน (${cLabel})`;
    select.appendChild(opt);

    const salaryDates = appData.summary.salaryDates || [];
    const pastSalaries = salaryDates.filter(d => new Date(d + "T00:00:00") < cS).sort((a, b) => new Date(b) - new Date(a));
    
    const formatYMD = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
    let nextStartDate = currentStart;
    let cycleCount = 0;

    for (let i = 0; i < pastSalaries.length; i++) {
      const sStr = pastSalaries[i];
      const sObj = new Date(sStr + "T00:00:00");
      let nObj = new Date(nextStartDate + "T00:00:00");

      const diffDays = Math.round((nObj - sObj) / (1000 * 60 * 60 * 24));
      if (diffDays < 7) {
        continue;
      }

      while (Math.round((nObj - sObj) / (1000 * 60 * 60 * 24)) > 45) {
        const endObj = new Date(nObj);
        endObj.setDate(endObj.getDate() - 1);
        const estStartObj = new Date(nObj.getFullYear(), nObj.getMonth() - 1, nObj.getDate());
        const estStartStr = formatYMD(estStartObj);
        const endStr = formatYMD(endObj);
        const label = `${estStartObj.getDate()} ${thMonths[estStartObj.getMonth()]} - ${endObj.getDate()} ${thMonths[endObj.getMonth()]}`;

        cycleCount++;
        let pastOpt = document.createElement('option');
        pastOpt.value = `${estStartStr}|${endStr}`;
        pastOpt.innerText = `${cycleCount} รอบที่แล้ว (${label})`;
        select.appendChild(pastOpt);

        nextStartDate = estStartStr;
        nObj = new Date(nextStartDate + "T00:00:00");
      }

      if (Math.round((nObj - sObj) / (1000 * 60 * 60 * 24)) < 7) {
        continue;
      }

      const endObj = new Date(nObj);
      endObj.setDate(endObj.getDate() - 1);
      const eStr = formatYMD(endObj);
      const label = `${sObj.getDate()} ${thMonths[sObj.getMonth()]} - ${endObj.getDate()} ${thMonths[endObj.getMonth()]}`;

      cycleCount++;
      let pastOpt = document.createElement('option');
      pastOpt.value = `${sStr}|${eStr}`;
      pastOpt.innerText = `${cycleCount} รอบที่แล้ว (${label})`;
      select.appendChild(pastOpt);

      nextStartDate = sStr;
    }

    while (cycleCount < 6) {
      const nObj = new Date(nextStartDate + "T00:00:00");
      const endObj = new Date(nObj);
      endObj.setDate(endObj.getDate() - 1);
      const estStartObj = new Date(nObj.getFullYear(), nObj.getMonth() - 1, nObj.getDate());
      const sVal = formatYMD(estStartObj);
      const eVal = formatYMD(endObj);
      const label = `${estStartObj.getDate()} ${thMonths[estStartObj.getMonth()]} - ${endObj.getDate()} ${thMonths[endObj.getMonth()]}`;

      cycleCount++;
      let pastOpt = document.createElement('option');
      pastOpt.value = `${sVal}|${eVal}`;
      pastOpt.innerText = `${cycleCount} รอบที่แล้ว (${label})`;
      select.appendChild(pastOpt);

      nextStartDate = sVal;
    }
    
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.innerText = 'กำหนดช่วงวันที่เอง...';
    select.appendChild(customOpt);
    
    handleCycleChange(false);
  }

  function handleCycleChange(autoLoad = true) {
    const val = document.getElementById('dash-cycle-select').value;
    const customBox = document.getElementById('custom-date-picker');
    const searchBtn = document.getElementById('dash-search-btn');
    
    if (val === 'custom') {
      if (document.getElementById('dash-end').value === '2099-12-31') {
        document.getElementById('dash-end').value = getTodayLocalStr();
      }
      customBox.style.display = 'flex';
      searchBtn.style.display = 'flex';
    } else {
      customBox.style.display = 'none';
      searchBtn.style.display = 'none';
      const parts = val.split('|');
      document.getElementById('dash-start').value = parts[0];
      document.getElementById('dash-end').value = parts[1];
      if (autoLoad) loadDashboard();
    }
  }

  function loadDashboard() {
    const start = document.getElementById('dash-start').value;
    const end = document.getElementById('dash-end').value;
    
    if (!start || !end) {
      showToast("กรุณาเลือกช่วงวันที่ให้ครบถ้วน");
      return;
    }
    
    showFullLoader("กำลังดึงข้อมูลประวัติ...");
    callBackend('getDashboardData', { start: start, end: end, account: currentAccount }, (res) => {
      hideFullLoader();
      if (res && res.success) {
        renderDashboardData(res.data);
      } else {
        showToast("โหลดข้อมูลล้มเหลว");
      }
    }, onError);
  }

  function renderDashboardData(data) {
    currentDashboardTransactions = data.transactions || [];
    currentDashboardSummary = data;

    if (currentAccount === 'kept') {
      document.getElementById('dash-title').innerText = "ยอดเงินรวมทั้งหมด (Kept)";
    } else if (currentAccount === 'kplus') {
      document.getElementById('dash-title').innerText = "ยอดเงินรวมรายได้เสริม (K PLUS)";
    } else {
      document.getElementById('dash-title').innerText = "สรุปยอดรวม";
    }

    document.getElementById('dash-balance').innerText = formatMoneyValue(data.balance);
    document.getElementById('dash-income').innerText = formatMoneyValue(data.income);
    document.getElementById('dash-expense').innerText = formatMoneyValue(data.expense);

    const momContainer = document.getElementById('mom-indicator');
    if (currentAccount === 'kept' || currentAccount === 'kplus') {
      momContainer.innerHTML = '';
      momContainer.style.display = 'none';
    } else if (data.previousExpense !== undefined) {
      momContainer.style.display = 'block';
      if (data.previousExpense === 0) {
        momContainer.innerHTML = `<span class="mom-badge same">ไม่มีข้อมูลรอบก่อน</span>`;
      } else {
        const diff = data.expense - data.previousExpense;
        const percent = ((Math.abs(diff) / data.previousExpense) * 100).toFixed(1);
        
        if (diff > 0) {
          momContainer.innerHTML = `<span class="mom-badge up"><i class="fa-solid fa-arrow-trend-up" aria-hidden="true"></i> รายจ่ายเพิ่มขึ้น ${percent}% จากรอบที่แล้ว</span>`;
        } else if (diff < 0) {
          momContainer.innerHTML = `<span class="mom-badge down"><i class="fa-solid fa-arrow-trend-down" aria-hidden="true"></i> รายจ่ายลดลง ${percent}%</span>`;
        } else {
          momContainer.innerHTML = `<span class="mom-badge same"><i class="fa-solid fa-minus" aria-hidden="true"></i> รายจ่ายเท่าเดิม</span>`;
        }
      }
    } else {
      momContainer.style.display = 'block';
      momContainer.innerHTML = '';
    }

    const labels = Object.keys(data.categorySummary || {});
    const values = Object.values(data.categorySummary || {});

    const chartCard = document.getElementById('dash-chart-card');
    if (values.length === 0 || values.reduce((a, b) => a + b, 0) === 0) {
      chartCard.style.display = 'none';
      document.getElementById('dash-ranking-card').style.display = 'none';
      return;
    }

    chartCard.style.display = 'block';
    document.getElementById('dash-ranking-card').style.display = 'block';

    const ctx = document.getElementById('dashChart').getContext('2d');
    if (dashChartInstance) dashChartInstance.destroy();
    
    const bgColors = ['#ffb3c6', '#60a5fa', '#fbcfe8', '#bae6fd', '#fb7185', '#38bdf8', '#f472b6', '#a78bfa', '#34d399', '#fcd34d'];
    
    dashChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{ data: values, backgroundColor: bgColors, borderWidth: 1 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });

    const list = document.getElementById('dash-ranking-list');
    list.innerHTML = '';
    
    const sorted = labels.map((label, i) => ({ label, value: values[i], color: bgColors[i % bgColors.length] }))
                         .sort((a, b) => b.value - a.value);
                         
    sorted.forEach(item => {
      const percent = ((item.value / data.expense) * 100).toFixed(1);
      const div = document.createElement('div');
      div.className = 'ranking-item';
      div.style.cursor = 'pointer';
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.onclick = () => showCategoryDetails(item.label, item.value);
      div.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') showCategoryDetails(item.label, item.value); };
      div.innerHTML = `
        <div class="ranking-header">
          <span>${item.label} (${percent}%)</span>
          <span style="color: var(--danger);">฿${parseFloat(item.value).toLocaleString('th-TH')}</span>
        </div>
        <div class="progress-bg">
          <div class="progress-bar" style="width: ${percent}%; background-color: ${item.color};"></div>
        </div>
      `;
      list.appendChild(div);
    });
  }

  // ==========================================
  // Category & Income Details in Dashboard
  // ==========================================
  function showIncomeDetails() {
    if (!currentDashboardSummary) return;
    document.getElementById('category-detail-title').innerText = "รายการรายรับทั้งหมดในรอบนี้";
    document.getElementById('category-detail-amount').innerText = formatMoneyValue(currentDashboardSummary.income || 0);
    const filteredTx = currentDashboardTransactions.filter(tx => tx.type === 'รายรับ');
    renderDetailModalList(filteredTx);
    document.getElementById('category-detail-modal').classList.add('active');
  }

  function showCategoryDetails(categoryName, totalAmount) {
    document.getElementById('category-detail-title').innerText = categoryName;
    document.getElementById('category-detail-amount').innerText = formatMoneyValue(totalAmount);
    const filteredTx = currentDashboardTransactions.filter(tx => tx.category === categoryName && tx.type === 'รายจ่าย');
    renderDetailModalList(filteredTx);
    document.getElementById('category-detail-modal').classList.add('active');
  }

  function renderDetailModalList(filteredTx) {
    const listEl = document.getElementById('category-detail-list');
    listEl.innerHTML = '';
    
    if (filteredTx.length === 0) {
      listEl.innerHTML = '<div class="empty-state">ไม่มีรายการย่อย</div>';
    } else {
      filteredTx.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'transaction-item';
        
        const isIncome = tx.type === 'รายรับ';
        const iconHtml = isIncome
          ? '<i class="fa-solid fa-arrow-down" aria-hidden="true" style="color:var(--success)"></i>'
          : '<i class="fa-solid fa-money-bill-wave" aria-hidden="true" style="color:var(--danger)"></i>';
        const amountClass = isIncome ? 'income' : 'expense';
        const prefix = isIncome ? '+' : '-';
        
        item.innerHTML = `
          <div class="tx-left">
            <div class="tx-icon">${iconHtml}</div>
            <div class="tx-details">
              <h4>${tx.category}</h4>
              <p>${tx.note || '-'}</p>
            </div>
          </div>
          <div class="tx-right">
            <div>
              <div class="tx-amount ${amountClass}">${prefix}฿${parseFloat(tx.amount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div class="tx-date">${tx.date}</div>
            </div>
            <button type="button" class="delete-icon-btn" onclick="deleteDashTx('${tx.id}')" aria-label="ลบรายการ ${tx.category}">
              <i class="fa-solid fa-trash" aria-hidden="true"></i>
            </button>
          </div>
        `;
        listEl.appendChild(item);
      });
    }
  }

  function deleteDashTx(id) {
    if (!confirm("ต้องการลบรายการนี้ใช่หรือไม่?")) return;
    closeCategoryDetails();
    showFullLoader("กำลังลบรายการ...");
    callBackend('deleteTransaction', { id: id, account: currentAccount }, (res) => {
      if (res && res.success) {
        showToast(res.message);
        callBackend('getInitialData', { account: currentAccount }, (data) => {
          try {
            localStorage.setItem(getCacheKey(currentAccount), JSON.stringify(data));
          } catch (e) {}
          onDataLoaded(data);
          loadDashboard();
        }, onError);
      } else {
        hideFullLoader();
        showToast("ลบไม่สำเร็จ: " + (res ? res.message : ""));
      }
    }, onError);
  }

  function closeCategoryDetails() {
    document.getElementById('category-detail-modal').classList.remove('active');
  }