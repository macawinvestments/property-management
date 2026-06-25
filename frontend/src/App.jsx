import { useState, useEffect } from 'react';
import { api } from './api.js';

const commas = (n) =>
  n == null || n === '' || isNaN(n) ? '' : Number(n).toLocaleString('en-US');

const usd = (n) =>
  n == null || isNaN(n)
    ? '$0'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function App() {
  const [deal, setDeal] = useState({
    name: '',
    address: '',
    squareFootage: '',
    askingPrice: '',
    offerPct: '',
    capitalizedRehab: '',
    nonCapitalizedRehab: '',
    occupancyPct: '',
    incomePerSF: '',
    downPaymentPct: '30',
    interestRate: '',
    termYears: '30',
    amortType: 'pi', // 'pi' | 'io'
    useMezz: false,
    mezzInterestRate: '',
    mezzTermYears: '',
    mezzAmortType: 'pi',
    // Acquisition Fee stays manual for now (needs total project cost, built later)
    acquisitionFeeManual: '',
  });

  // Settings — hard defaults. PSF values drive the pure-PSF lines below.
  const [settings, setSettings] = useState({
    downPaymentPctDefault: '30',
    termYearsDefault: '30',
    proformaOccupancy: '98',
    assetMgmtFeePct: '3.5',
    capitalReservePsf: '0.15',
    gpAllocationCap: '20',
    salesCommission: '3',
    psf: {
      legalStartup: '7.13',
      tenantImprovements: '0',
      extraTiLc: '12.00',
      roofBudget: '4.10',
      renovationsBudget: '2.19',
      operatingCapitalReserves: '1.37',
      finCmbs: '0.82',
      finMezz: '0',
      taxesLienEscrow: '0.77',
      insurancePremium: '0.79',
      legalFeesHWA: '0.70',
      reFeesNAI: '0', // formula-driven (0.5% of purchase), PSF unused
      titleFeesOnLoan: '0.41',
      tiLcCmbs: '3.00',
      capexCmbs: '1.00',
    },
  });
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState('deal'); // 'deal' | 'proforma' | 'pipeline'

  // Persistence state
  const [currentDealId, setCurrentDealId] = useState(null); // null = unsaved/new
  const [saveState, setSaveState] = useState('idle');       // idle | saving | saved | error
  const [saveError, setSaveError] = useState('');
  const [pipeline, setPipeline] = useState([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);

  // Proforma inputs (10-year projection)
  const [proforma, setProforma] = useState({
    yearlyRentIncrease: '3',          // one rate applied to all years
    includeRefi: false,
    refiYear: '6',
    miscByYear: Array(10).fill(''),   // manual per year
    nnnByYear: Array(10).fill(''),    // manual per year
    expensesAnnuallyByYear: Array(10).fill(''),  // manual per year
    leasingCapexTiByYear: Array(10).fill(''),    // manual per year
  });
  const setPf = (key, value) => setProforma((p) => ({ ...p, [key]: value }));
  const setPfYear = (key, idx, value) =>
    setProforma((p) => {
      const arr = p[key].slice();
      arr[idx] = value;
      return { ...p, [key]: arr };
    });

  // ---- Persistence ----
  // The full input state that gets saved (restores a deal exactly).
  const snapshot = () => ({ deal, settings, proforma });

  async function saveDeal() {
    setSaveState('saving');
    setSaveError('');
    try {
      const data = snapshot();
      if (currentDealId) {
        await api.updateDeal(currentDealId, data);
      } else {
        const created = await api.createDeal(data, 'active');
        setCurrentDealId(created.id);
      }
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      setSaveState('error');
      setSaveError(err.message || 'Save failed');
    }
  }

  async function loadPipeline() {
    setPipelineLoading(true);
    try {
      const list = await api.listDeals();
      setPipeline(list);
    } catch (err) {
      setPipeline([]);
    } finally {
      setPipelineLoading(false);
    }
  }

  async function openDeal(id) {
    try {
      const row = await api.getDeal(id);
      const d = row.data || {};
      if (d.deal) setDeal(d.deal);
      if (d.settings) setSettings(d.settings);
      if (d.proforma) setProforma(d.proforma);
      setCurrentDealId(row.id);
      setTab('deal');
    } catch (err) {
      alert('Could not open deal: ' + (err.message || 'error'));
    }
  }

  async function changeStatus(id, status) {
    try {
      await api.setStatus(id, status);
      loadPipeline();
    } catch (err) {
      alert('Could not change status: ' + (err.message || 'error'));
    }
  }

  async function removeDeal(id) {
    if (!confirm('Delete this deal? This cannot be undone.')) return;
    try {
      await api.deleteDeal(id);
      if (currentDealId === id) setCurrentDealId(null);
      loadPipeline();
    } catch (err) {
      alert('Could not delete: ' + (err.message || 'error'));
    }
  }

  function newDeal() {
    setCurrentDealId(null);
    setDeal((d) => ({ ...d, name: '', address: '' }));
    setSaveState('idle');
  }

  // Load the pipeline list whenever that tab opens.
  useEffect(() => {
    if (tab === 'pipeline') loadPipeline();
  }, [tab]);

  const set = (key, value) => setDeal((d) => ({ ...d, [key]: value }));
  const setPsf = (key, value) =>
    setSettings((s) => ({ ...s, psf: { ...s.psf, [key]: value } }));
  const setSetting = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

  const n = (v) => Number(v) || 0;
  const SF = n(deal.squareFootage);
  const psf = settings.psf;

  // Automatic calculations
  // Purchase price = asking × offer%
  const purchasePrice =
    (Number(deal.askingPrice) || 0) * ((Number(deal.offerPct) || 0) / 100);
  // Total to be financed = purchase price + capitalized rehab
  const totalToFinance = purchasePrice + (Number(deal.capitalizedRehab) || 0);

  const vacancyPct =
    deal.occupancyPct === '' || isNaN(Number(deal.occupancyPct))
      ? ''
      : 100 - Number(deal.occupancyPct);

  // Financing
  const downPaymentAmt =
    totalToFinance * ((Number(deal.downPaymentPct) || 0) / 100);
  const loanAmount = totalToFinance - downPaymentAmt;

  // Debt service helper (used by senior and mezz)
  function debtService(principal, ratePct, years, amortType) {
    const r = (Number(ratePct) || 0) / 100;
    const n = Number(years) || 0;
    if (!(principal > 0) || !(r > 0)) return { monthly: 0, annual: 0 };
    if (amortType === 'io') {
      const annual = principal * r;
      return { monthly: annual / 12, annual };
    }
    if (n > 0) {
      const rm = r / 12;
      const nm = n * 12;
      const monthly = (principal * rm) / (1 - Math.pow(1 + rm, -nm));
      return { monthly, annual: monthly * 12 };
    }
    return { monthly: 0, annual: 0 };
  }

  // Per-year interest & principal split over a 30-yr (term) amortization.
  // Returns arrays length `horizon` of {interest, principal} for each year.
  // Interest-only: interest = principal×rate every year, principal paid = 0.
  function amortSplit(loan, ratePct, years, amortType, horizon) {
    const out = [];
    const r = (Number(ratePct) || 0) / 100;
    if (!(loan > 0) || !(r > 0)) {
      for (let y = 0; y < horizon; y++) out.push({ interest: 0, principal: 0, balEnd: loan || 0 });
      return out;
    }
    if (amortType === 'io') {
      for (let y = 0; y < horizon; y++) out.push({ interest: loan * r, principal: 0, balEnd: loan });
      return out;
    }
    const rm = r / 12;
    const nm = (Number(years) || 30) * 12;
    const monthly = (loan * rm) / (1 - Math.pow(1 + rm, -nm));
    let bal = loan;
    for (let y = 0; y < horizon; y++) {
      let yrInterest = 0, yrPrincipal = 0;
      for (let m = 0; m < 12; m++) {
        const interest = bal * rm;
        const principal = monthly - interest;
        yrInterest += interest;
        yrPrincipal += principal;
        bal -= principal;
      }
      out.push({ interest: yrInterest, principal: yrPrincipal, balEnd: bal });
    }
    return out;
  }

  // Senior debt service
  const senior = debtService(loanAmount, deal.interestRate, deal.termYears, deal.amortType);
  const annualDebtService = senior.annual;
  const monthlyDebtService = senior.monthly;

  // Mezzanine: amount = purchase price − senior loan amount
  const mezzAmount = deal.useMezz ? Math.max(purchasePrice - loanAmount, 0) : 0;
  const mezz = debtService(mezzAmount, deal.mezzInterestRate, deal.mezzTermYears, deal.mezzAmortType);

  // Each Operating Capital / Closing line's computed dollar value.
  // Pure-PSF lines: SF × psf. Formula lines: from loan/mezz/purchase.
  const occ = {
    // Closing Costs
    taxesLienEscrow: SF * n(psf.taxesLienEscrow),
    insurancePremium: SF * n(psf.insurancePremium),
    titleFeesOnLoan: SF * n(psf.titleFeesOnLoan),
    legalFeesHWA: SF * n(psf.legalFeesHWA),
    reFeesNAI: purchasePrice * 0.005,                       // 0.5% of purchase price
    // Operations
    legalStartup: SF * n(psf.legalStartup),
    tenantImprovements: SF * n(psf.tenantImprovements),
    extraTiLc: SF * n(psf.extraTiLc),
    roofBudget: SF * n(psf.roofBudget),
    renovationsBudget: SF * n(psf.renovationsBudget),
    operatingCapitalReserves: SF * n(psf.operatingCapitalReserves),
    // Required Reserves
    tiLcCmbs: SF * n(psf.tiLcCmbs),
    capexCmbs: SF * n(psf.capexCmbs),
    // Financial Expenses
    finCmbs: SF * n(psf.finCmbs),
    finMezz: SF * n(psf.finMezz),
    finCbre: (loanAmount + mezzAmount) * 0.01,              // 1% of total debt
    buyDownReserve: loanAmount * 0.06,                      // 6% of senior debt
    acquisitionFee: 0,                                       // set below (circular)
  };

  // Acquisition Fee = 3% of Total Project Cost, where Total Project Cost
  // INCLUDES the fee (his circular reference). Solve algebraically:
  //   fee = 0.03 × (base + fee)  ->  fee = 0.03 × base / 0.97
  // base = everything in project cost EXCEPT the acquisition fee.
  const acqRate = 0.03;
  const baseForAcq =
    purchasePrice
    + (occ.taxesLienEscrow + occ.insurancePremium + occ.titleFeesOnLoan + occ.legalFeesHWA + occ.reFeesNAI)
    + (occ.legalStartup + occ.tenantImprovements + occ.extraTiLc + occ.roofBudget + occ.renovationsBudget + occ.operatingCapitalReserves)
    + (occ.tiLcCmbs + occ.capexCmbs)
    + (occ.finCmbs + occ.finMezz + occ.finCbre + occ.buyDownReserve);
  occ.acquisitionFee = (acqRate * baseForAcq) / (1 - acqRate);

  const closingCostsTotal =
    occ.taxesLienEscrow + occ.insurancePremium + occ.titleFeesOnLoan + occ.legalFeesHWA + occ.reFeesNAI;
  const operationsTotal =
    occ.legalStartup + occ.tenantImprovements + occ.extraTiLc + occ.roofBudget + occ.renovationsBudget + occ.operatingCapitalReserves;
  const requiredReservesTotal = occ.tiLcCmbs + occ.capexCmbs;
  const financialExpensesTotal =
    occ.finCmbs + occ.finMezz + occ.finCbre + occ.buyDownReserve + occ.acquisitionFee;
  const operatingCapitalClosingTotal =
    closingCostsTotal + operationsTotal + requiredReservesTotal + financialExpensesTotal;

  // ---- Project Cost ----
  // His "Closing Costs" = our Closing Costs sub-group.
  // His "Operating Capital" = our Operations + Required Reserves + Financial Expenses.
  const projClosingCosts = closingCostsTotal;
  const projOperatingCapital = operationsTotal + requiredReservesTotal + financialExpensesTotal;
  // Total Project Cost = Purchase Price + Closing Costs + Operating Capital.
  const totalProjectCost = purchasePrice + projClosingCosts + projOperatingCapital;
  // Capital-stack breakdown (display): debt + equity fund the purchase.
  const equityDownPayment = downPaymentAmt;

  // Total for Closing = the 4 sections (operating capital/closing) + down payment.
  // This is the Capital Accounts figure used in the exit waterfall.
  // (Distinct from Minimum to Close, which is informational only.)
  const totalForClosing = operatingCapitalClosingTotal + downPaymentAmt;

  // ---- Minimum to Close ----
  // Equity for loan = down payment.
  const equityForLoan = downPaymentAmt;
  // Buy Down Money = our Buy Down Reserve (6% of senior loan).
  const buyDownMoney = occ.buyDownReserve;
  // Fees = sum of these 11 lines: Legal & Startup, Fin-CMBS, Fin-Mezz,
  // Fin-CBRE, TI/LC-CMBS, Capex-CMBS, 2mo Taxes, Insurance, Title Fees,
  // Legal Fees-HWA, RE Fees-NAI.
  // Excludes: Tenant Improvements, Extra TI&LC, Roof, Renovations,
  // Operating Capital Reserves, Buy Down Reserve, Acquisition Fee.
  const fees =
    occ.legalStartup
    + occ.finCmbs + occ.finMezz + occ.finCbre
    + occ.tiLcCmbs + occ.capexCmbs
    + occ.taxesLienEscrow + occ.insurancePremium + occ.titleFeesOnLoan
    + occ.legalFeesHWA + occ.reFeesNAI;
  // Minimum to Close = equity for loan + buy down money + fees.
  const minimumToClose = equityForLoan + buyDownMoney + fees;

  // ---- Proforma (10-year projection) ----
  const pricePerSF = n(deal.incomePerSF);               // annual rent per SF (Deal page)
  const projOccupancy = n(settings.proformaOccupancy) / 100; // default 0.98
  const rentInc = n(proforma.yearlyRentIncrease) / 100;
  const HORIZON = 10;
  const refiYearNum = proforma.includeRefi ? Math.max(1, Math.min(HORIZON, n(proforma.refiYear))) : null;

  // Per-year interest/principal for senior (+ mezz when on), over 30-yr amort.
  const seniorSplit = amortSplit(loanAmount, deal.interestRate, deal.termYears, deal.amortType, HORIZON);
  const mezzSplit = deal.useMezz
    ? amortSplit(mezzAmount, deal.mezzInterestRate, deal.mezzTermYears, deal.mezzAmortType, HORIZON)
    : Array(HORIZON).fill({ interest: 0, principal: 0 });

  // Debt service for DSCR: senior (+ mezz when on).
  const debtServiceForDscr = annualDebtService + (deal.useMezz ? mezz.annual : 0);
  const loanForYield = loanAmount;
  const loanForYieldMezz = loanAmount + mezzAmount;

  // Non-op settings
  const assetMgmtFeePct = n(settings.assetMgmtFeePct) / 100; // 3.5% default
  const capReservePsf = n(settings.capitalReservePsf);       // $0.15 default
  const capitalReservesAnnual = capReservePsf * SF;

  // GP allocation ramp: 10% in year 1, rising evenly to the cap (default 20%)
  // by year 5, then held at the cap through year 10.
  const gpCap = n(settings.gpAllocationCap) / 100; // default 0.20
  const gpStart = 0.10;
  const gpByYear = [];
  for (let y = 1; y <= HORIZON; y++) {
    if (y >= 5) gpByYear.push(gpCap);
    else gpByYear.push(gpStart + (gpCap - gpStart) * ((y - 1) / 4));
  }

  // Total Operating Capital & Closing — the equity basis ROI is measured on.
  const equityBasis = operatingCapitalClosingTotal;

  // Exit waterfall constants.
  const salesCommissionPct = n(settings.salesCommission) / 100;     // default 0.03
  const netSaleFactor = 1 - salesCommissionPct;                     // 97%
  const capitalAccounts = totalForClosing;                          // 4 sections + down payment
  const investorShareOfProfitPct = 1 - gpCap;                       // 100% − max GP share
  let cumulativeInvestorCF = 0;                                     // running distributions
  let purchaseCap = null;                                           // Year-1 NOI / purchase price (fixed)

  const proformaRows = [];
  let prevTotalNetIncome = null;
  for (let y = 1; y <= HORIZON; y++) {
    const i = y - 1;
    // Rent factor compounds the yearly increase (Year 1 = base).
    const rentFactor = Math.pow(1 + rentInc, i);
    const gpr = SF * pricePerSF * rentFactor;                       // full potential at 100%
    const vacancyLoss = (1 - projOccupancy) * SF * pricePerSF * rentFactor;
    const netRentalIncome = gpr - vacancyLoss;
    const misc = n(proforma.miscByYear[i]);
    const nnn = n(proforma.nnnByYear[i]);
    const nnnCostPerSF = SF ? nnn / SF : 0;
    const totalNetIncome = netRentalIncome + misc + nnn;
    const yoyGrowth = prevTotalNetIncome ? totalNetIncome / prevTotalNetIncome - 1 : null;
    const monthlyIncome = totalNetIncome / 12;
    prevTotalNetIncome = totalNetIncome;
    // Operating Expenses
    const expensesAnnually = n(proforma.expensesAnnuallyByYear[i]);
    const expensesPerSF = SF ? expensesAnnually / SF : 0;
    const leasingCapexTi = n(proforma.leasingCapexTiByYear[i]);
    const totalExpenses = expensesAnnually + leasingCapexTi;
    const expensesPctOfIncome = totalNetIncome ? totalExpenses / totalNetIncome : null;
    // NOI & debt metrics
    const noi = totalNetIncome - totalExpenses;
    const dscr = debtServiceForDscr ? noi / debtServiceForDscr : null;
    const debtYield = loanForYield ? noi / loanForYield : null;
    const debtYieldMezz = loanForYieldMezz ? noi / loanForYieldMezz : null;
    // Non-operating expenses
    const interest = seniorSplit[i].interest + mezzSplit[i].interest;
    const principal = seniorSplit[i].principal + mezzSplit[i].principal;
    const assetMgmtFee = assetMgmtFeePct * netRentalIncome;
    const totalNonOp = interest + principal + assetMgmtFee + capitalReservesAnnual;
    // Profitability
    const propertyCashFlow = noi - totalNonOp;
    const propertyROI = totalForClosing ? propertyCashFlow / totalForClosing : null;
    const gpPct = gpByYear[i];
    const gpIncome = gpPct * propertyCashFlow;
    const investorCashFlow = propertyCashFlow - gpIncome;
    const investorROI = totalForClosing ? investorCashFlow / totalForClosing : null;
    const capRate = purchasePrice ? noi / purchasePrice : null;
    // Purchase (going-in) cap = Year-1 NOI / purchase price, fixed for all years.
    if (y === 1) purchaseCap = purchasePrice ? noi / purchasePrice : null;
    // Exit waterfall
    const gpr_ = gpr; // gross potential rent for break-even
    const breakEvenOcc = gpr_ ? (totalExpenses + debtServiceForDscr) / gpr_ : null;
    // Total Value at CAP = that year's NOI / the fixed purchase cap (value grows as NOI grows).
    const totalValueAtCap = purchaseCap ? noi / purchaseCap : null;
    const valuePricePerSF = totalValueAtCap && SF ? totalValueAtCap / SF : null;
    const netSaleProceeds = totalValueAtCap != null ? totalValueAtCap * netSaleFactor : null;
    // Loan payoff = remaining senior balance this year (IO = full loan).
    const loanPayoff = seniorSplit[i].balEnd;
    const mezzPayoff = deal.useMezz ? mezzAmount : 0;   // remaining original mezz amount
    const totalProfitFromSale =
      netSaleProceeds != null ? netSaleProceeds - loanPayoff - capitalAccounts - mezzPayoff : null;
    const investorShareOfProfit =
      totalProfitFromSale != null ? totalProfitFromSale * investorShareOfProfitPct : null;
    const investorReturnFromSale =
      investorShareOfProfit != null && capitalAccounts ? investorShareOfProfit / capitalAccounts : null;
    // Distributions = accumulated investor cash flow through this year.
    cumulativeInvestorCF += investorCashFlow;
    const accumulatedDistributions = cumulativeInvestorCF;
    const distributionsPct = capitalAccounts ? accumulatedDistributions / capitalAccounts : null;
    const investorTotalReturn =
      (distributionsPct || 0) + (investorReturnFromSale || 0);
    const annualizedReturn = investorTotalReturn / y;
    const regime = refiYearNum && y >= refiYearNum ? 'refi' : 'hold';
    proformaRows.push({
      year: y, regime, gpr, vacancyLoss, netRentalIncome,
      misc, nnn, nnnCostPerSF, totalNetIncome, yoyGrowth, monthlyIncome,
      expensesAnnually, expensesPerSF, leasingCapexTi, totalExpenses, expensesPctOfIncome,
      noi, debtService: debtServiceForDscr, dscr, debtYield, debtYieldMezz,
      interest, principal, assetMgmtFee, capitalReserves: capitalReservesAnnual, totalNonOp,
      propertyCashFlow, propertyROI, gpPct, gpIncome, investorCashFlow, investorROI, capRate,
      breakEvenOcc, totalValueAtCap, valuePricePerSF, netSaleProceeds, loanPayoff, mezzPayoff,
      capitalAccounts, totalProfitFromSale, investorShareOfProfit, investorReturnFromSale,
      accumulatedDistributions, distributionsPct, investorTotalReturn, annualizedReturn,
    });
  }

  return (
    <div className={`app ${tab === 'proforma' ? 'wide' : ''}`}>
      <header className="masthead">
        <div className="brand">
          Otima Investments
          <span className="sub">Deal Underwriting{currentDealId ? ` · #${currentDealId}` : ' · unsaved'}</span>
        </div>
        <div className="masthead-actions">
          <button className="save-btn" onClick={saveDeal} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? 'Saving…'
              : saveState === 'saved' ? 'Saved ✓'
              : currentDealId ? 'Update Deal' : 'Save Deal'}
          </button>
          <button className="settings-btn" onClick={() => setShowSettings((s) => !s)}>
            {showSettings ? 'Close settings' : 'Settings'}
          </button>
        </div>
      </header>
      {saveState === 'error' && <div className="save-error">Save failed: {saveError}</div>}

      {showSettings && (
        <section className="panel settings-panel">
          <h2>Settings — Hard Defaults</h2>
          <div className="grid2">
            <Field label="Down payment % (default)">
              <Num value={settings.downPaymentPctDefault} onChange={(v) => { setSetting('downPaymentPctDefault', v); set('downPaymentPct', v); }} suffix="%" />
            </Field>
            <Field label="Term years (default)">
              <Num value={settings.termYearsDefault} onChange={(v) => { setSetting('termYearsDefault', v); set('termYears', v); }} suffix="yr" />
            </Field>
            <Field label="Proforma occupancy (default)">
              <Num value={settings.proformaOccupancy} onChange={(v) => setSetting('proformaOccupancy', v)} suffix="%" />
            </Field>
            <Field label="Asset mgmt fee (default)">
              <Num value={settings.assetMgmtFeePct} onChange={(v) => setSetting('assetMgmtFeePct', v)} suffix="%" />
            </Field>
            <Field label="Capital reserve / SF (default)">
              <Num value={settings.capitalReservePsf} onChange={(v) => setSetting('capitalReservePsf', v)} prefix="$" suffix="/SF" />
            </Field>
            <Field label="GP allocation cap (default)" note="Ramps 10% → cap by year 5">
              <Num value={settings.gpAllocationCap} onChange={(v) => setSetting('gpAllocationCap', v)} suffix="%" />
            </Field>
            <Field label="Sales commission (default)" note="Net sale = value × (100% − this)">
              <Num value={settings.salesCommission} onChange={(v) => setSetting('salesCommission', v)} suffix="%" />
            </Field>
          </div>

          <div className="settings-sub">Per-SF cost defaults</div>
          <p className="explainer">These $/SF values drive the Operating Capital / Closing lines automatically: each line's dollar = square footage × the value below.</p>
          <div className="psf-grid">
            <PsfField label="Legal & Startup" k="legalStartup" psf={psf} setPsf={setPsf} />
            <PsfField label="(Otima) Tenant Improvements" k="tenantImprovements" psf={psf} setPsf={setPsf} />
            <PsfField label="Extra TI&LC Reserves" k="extraTiLc" psf={psf} setPsf={setPsf} />
            <PsfField label="Roof Budget" k="roofBudget" psf={psf} setPsf={setPsf} />
            <PsfField label="Renovations Budget" k="renovationsBudget" psf={psf} setPsf={setPsf} />
            <PsfField label="Operating Capital Reserves" k="operatingCapitalReserves" psf={psf} setPsf={setPsf} />
            <PsfField label="Financial Expenses - CMBS" k="finCmbs" psf={psf} setPsf={setPsf} />
            <PsfField label="Financial Expenses - Mezz" k="finMezz" psf={psf} setPsf={setPsf} />
            <PsfField label="2 Months Taxes" k="taxesLienEscrow" psf={psf} setPsf={setPsf} />
            <PsfField label="Insurance Premium" k="insurancePremium" psf={psf} setPsf={setPsf} />
            <PsfField label="Legal Fees-HWA" k="legalFeesHWA" psf={psf} setPsf={setPsf} />
            <PsfField label="Title Fees on Loan" k="titleFeesOnLoan" psf={psf} setPsf={setPsf} />
            <PsfField label="TI/LC-CMBS Reserve" k="tiLcCmbs" psf={psf} setPsf={setPsf} />
            <PsfField label="Capex-CMBS Reserve" k="capexCmbs" psf={psf} setPsf={setPsf} />
          </div>
          <div className="settings-sub">Formula-driven (no PSF)</div>
          <p className="explainer">RE Fees-NAI = 0.5% of purchase price · Financial Expenses CBRE = 1% of total debt · Buy Down Reserve = 6% of senior loan · Acquisition Fee = manual (until total project cost is built).</p>
        </section>
      )}

      <div className="tabs">
        <button className={tab === 'deal' ? 'active' : ''} onClick={() => setTab('deal')}>Deal Inputs</button>
        <button className={tab === 'proforma' ? 'active' : ''} onClick={() => setTab('proforma')}>Proforma</button>
        <button className={tab === 'pipeline' ? 'active' : ''} onClick={() => setTab('pipeline')}>Pipeline</button>
      </div>

      {tab === 'deal' && (
      <>
      <section className="panel">
        <h2>The Deal</h2>
        <div className="grid2">
          <Field label="Name">
            <input
              className="text"
              value={deal.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Valley Crossing"
            />
          </Field>

          <Field label="Address">
            <input
              className="text"
              value={deal.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="e.g. 123 Main St, City, ST"
            />
          </Field>

          <Field label="Square footage">
            <Num value={deal.squareFootage} onChange={(v) => set('squareFootage', v)} suffix="SF" />
          </Field>

          <Field label="Asking price">
            <Num value={deal.askingPrice} onChange={(v) => set('askingPrice', v)} prefix="$" />
          </Field>

          <Field label="Offer %">
            <Num value={deal.offerPct} onChange={(v) => set('offerPct', v)} suffix="%" />
          </Field>

          <Field label="Purchase price" note="Asking × offer %">
            <Num value={purchasePrice} prefix="$" calc />
          </Field>

          <Field label="Capitalized rehab">
            <Num value={deal.capitalizedRehab} onChange={(v) => set('capitalizedRehab', v)} prefix="$" />
          </Field>

          <Field label="Total to be financed" note="Purchase price + capitalized rehab">
            <Num value={totalToFinance} prefix="$" calc emph />
          </Field>

          <Field label="Non-capitalized rehab">
            <Num value={deal.nonCapitalizedRehab} onChange={(v) => set('nonCapitalizedRehab', v)} prefix="$" />
          </Field>

          <Field label="Occupancy %">
            <Num value={deal.occupancyPct} onChange={(v) => set('occupancyPct', v)} suffix="%" />
          </Field>

          <Field label="Vacancy %" note="100% − occupancy">
            <Num value={vacancyPct} suffix="%" calc />
          </Field>

          <Field label="Income per SF" note="Annual rent charged per SF">
            <Num value={deal.incomePerSF} onChange={(v) => set('incomePerSF', v)} prefix="$" />
          </Field>
        </div>
      </section>

      <section className="panel">
        <h2>Financing</h2>
        <div className="grid2">
          <Field label="Down payment %" note="Of total to be financed">
            <Num value={deal.downPaymentPct} onChange={(v) => set('downPaymentPct', v)} suffix="%" />
          </Field>

          <Field label="Down payment amount" note="% × total to be financed">
            <Num value={downPaymentAmt} prefix="$" calc />
          </Field>

          <Field label="Loan amount" note="Total to be financed − down payment">
            <Num value={loanAmount} prefix="$" calc />
          </Field>

          <Field label="Interest rate">
            <Num value={deal.interestRate} onChange={(v) => set('interestRate', v)} suffix="%" />
          </Field>

          <Field label="Term (years)">
            <Num value={deal.termYears} onChange={(v) => set('termYears', v)} suffix="yr" />
          </Field>

          <Field label="Amortization">
            <div className="seg">
              <button
                className={deal.amortType === 'pi' ? 'active' : ''}
                onClick={() => set('amortType', 'pi')}
              >
                P + I
              </button>
              <button
                className={deal.amortType === 'io' ? 'active' : ''}
                onClick={() => set('amortType', 'io')}
              >
                Interest only
              </button>
            </div>
          </Field>

          <Field label="Debt service — monthly" note={deal.amortType === 'io' ? 'Loan × rate ÷ 12' : 'Amortizing payment'}>
            <Num value={Math.round(monthlyDebtService)} prefix="$" calc />
          </Field>

          <Field label="Debt service — annual" note={deal.amortType === 'io' ? 'Loan × rate' : 'Monthly × 12'}>
            <Num value={Math.round(annualDebtService)} prefix="$" calc emph />
          </Field>
        </div>
      </section>

      <section className="panel">
        <h2 className="with-toggle">
          Mezzanine Debt
          <span className="seg inline-seg">
            <button className={!deal.useMezz ? 'active' : ''} onClick={() => set('useMezz', false)}>No</button>
            <button className={deal.useMezz ? 'active' : ''} onClick={() => set('useMezz', true)}>Yes</button>
          </span>
        </h2>

        {deal.useMezz && (
          <div className="grid2">
            <Field label="Mezzanine amount" note="Purchase price − senior loan">
              <Num value={Math.round(mezzAmount)} prefix="$" calc />
            </Field>

            <Field label="Interest rate">
              <Num value={deal.mezzInterestRate} onChange={(v) => set('mezzInterestRate', v)} suffix="%" />
            </Field>

            <Field label="Term (years)">
              <Num value={deal.mezzTermYears} onChange={(v) => set('mezzTermYears', v)} suffix="yr" />
            </Field>

            <Field label="Amortization">
              <div className="seg">
                <button className={deal.mezzAmortType === 'pi' ? 'active' : ''} onClick={() => set('mezzAmortType', 'pi')}>P + I</button>
                <button className={deal.mezzAmortType === 'io' ? 'active' : ''} onClick={() => set('mezzAmortType', 'io')}>Interest only</button>
              </div>
            </Field>

            <Field label="Mezz debt service — monthly" note={deal.mezzAmortType === 'io' ? 'Mezz × rate ÷ 12' : 'Amortizing payment'}>
              <Num value={Math.round(mezz.monthly)} prefix="$" calc />
            </Field>

            <Field label="Mezz debt service — annual" note={deal.mezzAmortType === 'io' ? 'Mezz × rate' : 'Monthly × 12'}>
              <Num value={Math.round(mezz.annual)} prefix="$" calc emph />
            </Field>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Operating Capital / Closing</h2>

        <SubGroup title="Closing Costs" subtotal={closingCostsTotal}>
          <OccField label="2 Months of Taxes — Lien Escrow at Closing" value={occ.taxesLienEscrow} note="PSF" />
          <OccField label="Insurance Premium Paid in Full" value={occ.insurancePremium} note="PSF" />
          <OccField label="Title Fees on Loan" value={occ.titleFeesOnLoan} note="PSF" />
          <OccField label="Legal Fees-HWA" value={occ.legalFeesHWA} note="PSF" />
          <OccField label="RE Fees-NAI" value={occ.reFeesNAI} note="0.5% of purchase" />
        </SubGroup>

        <SubGroup title="Operations" subtotal={operationsTotal}>
          <OccField label="Legal & Startup Expenses" value={occ.legalStartup} note="PSF" />
          <OccField label="(Otima) Tenant Improvements Reserves" value={occ.tenantImprovements} note="PSF" />
          <OccField label="Extra TI&LC Reserves" value={occ.extraTiLc} note="PSF" />
          <OccField label="Roof Budget" value={occ.roofBudget} note="PSF" />
          <OccField label="Renovations Budget" value={occ.renovationsBudget} note="PSF" />
          <OccField label="Operating Capital Reserves" value={occ.operatingCapitalReserves} note="PSF" />
        </SubGroup>

        <SubGroup title="Required Reserves" subtotal={requiredReservesTotal}>
          <OccField label="TI/LC-CMBS Reserve" value={occ.tiLcCmbs} note="PSF" />
          <OccField label="Capex-CMBS Reserve" value={occ.capexCmbs} note="PSF" />
        </SubGroup>

        <SubGroup title="Financial Expenses" subtotal={financialExpensesTotal}>
          <OccField label="Financial Expenses - CMBS" value={occ.finCmbs} note="PSF" />
          <OccField label="Financial Expenses - Mezz" value={occ.finMezz} note="PSF" />
          <OccField label="Financial Expenses - CBRE" value={occ.finCbre} note="1% of total debt" />
          <OccField label="Buy Down Reserve" value={occ.buyDownReserve} note="6% of senior" />
          <OccField label="Acquisition Fee" value={occ.acquisitionFee} note="3% of project cost" />
        </SubGroup>

        <div className="grand-total">
          <span>Total Operating Capital / Closing</span>
          <span className="gt-val">{usd(operatingCapitalClosingTotal)}</span>
        </div>
      </section>

      <section className="panel">
        <h2>Project Cost</h2>
        <div className="costbox">
          <CostLine label="Purchase Price" value={purchasePrice} />
          <CostLine label="Perm Debt" value={loanAmount} sub />
          <CostLine label="Mezz Debt" value={mezzAmount} sub />
          <CostLine label="Equity (Down Payment)" value={equityDownPayment} sub />
          <CostLine label="Closing Costs" value={projClosingCosts} />
          <CostLine label="Operating Capital" value={projOperatingCapital} />
          <div className="costbox-total">
            <span>Total Project Cost</span>
            <span>{usd(totalProjectCost)}</span>
          </div>
          <div className="costbox-total" style={{ borderTopColor: 'var(--ink-line)', borderTopWidth: 1 }}>
            <span>Total for Closing</span>
            <span>{usd(totalForClosing)}</span>
          </div>
        </div>
        <p className="explainer" style={{ marginTop: 12 }}>
          Perm Debt + Mezz + Equity fund the purchase price. Total Project Cost = Purchase Price + Closing Costs + Operating Capital. Total for Closing = the four cost sections + down payment.
        </p>

        <div className="costbox" style={{ marginTop: 24 }}>
          <div className="subgroup-head" style={{ marginBottom: 10 }}>
            <span className="subgroup-title">Minimum to Close</span>
            <span className="subgroup-subtotal" />
          </div>
          <CostLine label="Equity for loan" value={equityForLoan} />
          <CostLine label="Buy Down Money" value={buyDownMoney} />
          <CostLine label="Fees" value={fees} />
          <div className="costbox-total">
            <span>Minimum to Close</span>
            <span>{usd(minimumToClose)}</span>
          </div>
        </div>
        <p className="explainer" style={{ marginTop: 12 }}>
          Fees = Legal &amp; Startup, all Financial Expenses, TI/LC-CMBS, Capex-CMBS, taxes, insurance, title, legal, and RE fees.
        </p>
      </section>
      </>
      )}

      {tab === 'proforma' && (
        <ProformaTab
          rows={proformaRows}
          proforma={proforma}
          setPf={setPf}
          setPfYear={setPfYear}
          occupancy={settings.proformaOccupancy}
          refiYearNum={refiYearNum}
        />
      )}

      {tab === 'pipeline' && (
        <PipelineTab
          pipeline={pipeline}
          loading={pipelineLoading}
          currentDealId={currentDealId}
          onOpen={openDeal}
          onStatus={changeStatus}
          onDelete={removeDeal}
          onNew={newDeal}
          onRefresh={loadPipeline}
        />
      )}
    </div>
  );
}

// ---- Pipeline Tab: saved deals grouped by status ----
function PipelineTab({ pipeline, loading, currentDealId, onOpen, onStatus, onDelete, onNew, onRefresh }) {
  const usd0 = (n) =>
    n == null || isNaN(n) ? '—'
      : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const groups = [
    { key: 'active', label: 'Active' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'declined', label: 'Declined' },
  ];

  return (
    <section className="panel">
      <h2 className="with-toggle">
        Deal Pipeline
        <span>
          <button className="settings-btn" onClick={onNew} style={{ marginRight: 8 }}>+ New Deal</button>
          <button className="settings-btn" onClick={onRefresh}>Refresh</button>
        </span>
      </h2>

      {loading && <p className="explainer">Loading deals…</p>}
      {!loading && pipeline.length === 0 && (
        <p className="explainer">No saved deals yet. Build a deal on the Deal Inputs tab and click “Save Deal”.</p>
      )}

      {!loading && groups.map((g) => {
        const items = pipeline.filter((d) => d.status === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key} className="pipe-group">
            <div className="pipe-group-head">{g.label} <span className="pipe-count">{items.length}</span></div>
            <table className="pipe-table">
              <thead>
                <tr><th>Name</th><th>Address</th><th>Purchase Price</th><th>Updated</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} className={d.id === currentDealId ? 'pipe-current' : ''}>
                    <td>{d.name || <span className="pipe-dim">Untitled</span>}</td>
                    <td className="pipe-dim">{d.address || '—'}</td>
                    <td>{usd0(d.purchase_price)}</td>
                    <td className="pipe-dim">{new Date(d.updated_at).toLocaleDateString()}</td>
                    <td className="pipe-actions">
                      <button onClick={() => onOpen(d.id)}>Open</button>
                      {d.status !== 'accepted' && <button onClick={() => onStatus(d.id, 'accepted')}>Accept</button>}
                      {d.status !== 'declined' && <button onClick={() => onStatus(d.id, 'declined')}>Decline</button>}
                      {d.status !== 'active' && <button onClick={() => onStatus(d.id, 'active')}>Reactivate</button>}
                      <button className="pipe-del" onClick={() => onDelete(d.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}

// A line in the Project Cost box. `sub` marks the capital-stack breakdown
// rows (debt/equity) that fund the purchase, shown dimmer for distinction.
function CostLine({ label, value, sub }) {
  return (
    <div className={`cost-line ${sub ? 'sub' : ''}`}>
      <span>{label}</span>
      <span className="cost-val">{usd(value)}</span>
    </div>
  );
}

// ---- Proforma Tab: 10-year projection ----
function ProformaTab({ rows, proforma, setPf, setPfYear, occupancy, refiYearNum }) {
  const fmt = (v) => (v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US'));
  const fmtPct = (v) => (v == null || isNaN(v) ? '—' : (v * 100).toFixed(1) + '%');

  return (
    <>
      <section className="panel">
        <h2 className="with-toggle">
          Proforma — 10-Year Projection
          <span className="seg inline-seg">
            <button className={!proforma.includeRefi ? 'active' : ''} onClick={() => setPf('includeRefi', false)}>No Refi</button>
            <button className={proforma.includeRefi ? 'active' : ''} onClick={() => setPf('includeRefi', true)}>Refi</button>
          </span>
        </h2>
        <div className="grid2">
          <Field label="Projected occupancy" note="Set in Settings">
            <Num value={occupancy} suffix="%" calc />
          </Field>
          <Field label="Yearly rent increase" note="Applied to all years">
            <Num value={proforma.yearlyRentIncrease} onChange={(v) => setPf('yearlyRentIncrease', v)} suffix="%" />
          </Field>
          {proforma.includeRefi && (
            <Field label="Refi year" note="Hold period before · Refi period after">
              <Num value={proforma.refiYear} onChange={(v) => setPf('refiYear', v)} />
            </Field>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Operating Income</h2>
        <div className="pf-scroll">
          <table className="pf-grid">
            <thead>
              <tr>
                <th className="rowlabel">Line</th>
                {rows.map((r) => (
                  <th key={r.year} className={r.regime === 'refi' ? 'refi-col' : ''}>
                    Yr {r.year}
                    {refiYearNum && r.year === refiYearNum && <span className="refi-tag">refi</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PfRow label="Gross Potential Rent" rows={rows} get={(r) => fmt(r.gpr)} />
              <PfRow label="Vacancy Loss" rows={rows} get={(r) => fmt(r.vacancyLoss)} />
              <PfRow label="Net Rental Income" rows={rows} get={(r) => fmt(r.netRentalIncome)} strong />
              <PfRowInput label="Misc Other Income" rows={rows} values={proforma.miscByYear} onChange={(i, v) => setPfYear('miscByYear', i, v)} />
              <PfRowInput label="NNN Recovery Income" rows={rows} values={proforma.nnnByYear} onChange={(i, v) => setPfYear('nnnByYear', i, v)} />
              <PfRow label="NNN Cost per SF" rows={rows} get={(r) => (r.nnnCostPerSF ? '$' + r.nnnCostPerSF.toFixed(2) : '—')} dim />
              <PfRow label="Total Net Income" rows={rows} get={(r) => fmt(r.totalNetIncome)} strong />
              <PfRow label="YoY Income Growth" rows={rows} get={(r) => fmtPct(r.yoyGrowth)} dim />
              <PfRow label="Monthly Income" rows={rows} get={(r) => fmt(r.monthlyIncome)} dim />
            </tbody>
          </table>
        </div>
        {refiYearNum && (
          <p className="explainer" style={{ marginTop: 12 }}>
            Hold period: years 1–{refiYearNum - 1}. Refi period: years {refiYearNum}–10.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Operating Expenses</h2>
        <div className="pf-scroll">
          <table className="pf-grid">
            <thead>
              <tr>
                <th className="rowlabel">Line</th>
                {rows.map((r) => (
                  <th key={r.year} className={r.regime === 'refi' ? 'refi-col' : ''}>
                    Yr {r.year}
                    {refiYearNum && r.year === refiYearNum && <span className="refi-tag">refi</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PfRow label="Expenses / SF" rows={rows} get={(r) => (r.expensesPerSF ? '$' + r.expensesPerSF.toFixed(2) : '—')} dim />
              <PfRowInput label="Expenses Annually" rows={rows} values={proforma.expensesAnnuallyByYear} onChange={(i, v) => setPfYear('expensesAnnuallyByYear', i, v)} />
              <PfRowInput label="Leasing Comm. + Cap Reserves + TIs" rows={rows} values={proforma.leasingCapexTiByYear} onChange={(i, v) => setPfYear('leasingCapexTiByYear', i, v)} />
              <PfRow label="Expenses as % of Income" rows={rows} get={(r) => (r.expensesPctOfIncome == null ? '—' : (r.expensesPctOfIncome * 100).toFixed(1) + '%')} dim />
              <PfRow label="Total Expenses" rows={rows} get={(r) => fmt(r.totalExpenses)} strong />
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Net Operating Income & Debt Metrics</h2>
        <div className="pf-scroll">
          <table className="pf-grid">
            <thead>
              <tr>
                <th className="rowlabel">Line</th>
                {rows.map((r) => (
                  <th key={r.year} className={r.regime === 'refi' ? 'refi-col' : ''}>
                    Yr {r.year}
                    {refiYearNum && r.year === refiYearNum && <span className="refi-tag">refi</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PfRow label="Net Operating Income (NOI)" rows={rows} get={(r) => fmt(r.noi)} strong />
              <PfRow label="Debt Service (annual)" rows={rows} get={(r) => fmt(r.debtService)} />
              <PfRow label="DSCR" rows={rows} get={(r) => (r.dscr == null ? '—' : r.dscr.toFixed(2) + 'x')} dim />
              <PfRow label="Debt Yield" rows={rows} get={(r) => (r.debtYield == null ? '—' : (r.debtYield * 100).toFixed(2) + '%')} dim />
              <PfRow label="Debt Yield (w/ Mezz)" rows={rows} get={(r) => (r.debtYieldMezz == null ? '—' : (r.debtYieldMezz * 100).toFixed(2) + '%')} dim />
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Non-Operating Expenses</h2>
        <div className="pf-scroll">
          <table className="pf-grid">
            <thead>
              <tr>
                <th className="rowlabel">Line</th>
                {rows.map((r) => (
                  <th key={r.year} className={r.regime === 'refi' ? 'refi-col' : ''}>
                    Yr {r.year}
                    {refiYearNum && r.year === refiYearNum && <span className="refi-tag">refi</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PfRow label="Interest" rows={rows} get={(r) => fmt(r.interest)} />
              <PfRow label="Principal" rows={rows} get={(r) => fmt(r.principal)} />
              <PfRow label="Asset Management Fee" rows={rows} get={(r) => fmt(r.assetMgmtFee)} dim />
              <PfRow label="Capital Reserves" rows={rows} get={(r) => fmt(r.capitalReserves)} dim />
              <PfRow label="Total Non-Operating Expenses" rows={rows} get={(r) => fmt(r.totalNonOp)} strong />
            </tbody>
          </table>
        </div>
        <p className="explainer" style={{ marginTop: 12 }}>
          Asset mgmt fee = 3.5% of net rental income · Capital reserves = $0.15/SF (both set in Settings). Interest/Principal from a 30-yr amortization{' '}(P+I) or interest-only.
        </p>
      </section>

      <section className="panel">
        <h2>Profitability</h2>
        <div className="pf-scroll">
          <table className="pf-grid">
            <thead>
              <tr>
                <th className="rowlabel">Line</th>
                {rows.map((r) => (
                  <th key={r.year} className={r.regime === 'refi' ? 'refi-col' : ''}>
                    Yr {r.year}
                    {refiYearNum && r.year === refiYearNum && <span className="refi-tag">refi</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PfRow label="Property Cash Flow (Annual)" rows={rows} get={(r) => fmt(r.propertyCashFlow)} strong />
              <PfRow label="Property ROI" rows={rows} get={(r) => (r.propertyROI == null ? '—' : (r.propertyROI * 100).toFixed(2) + '%')} dim />
              <PfRow label="GP Allocation %" rows={rows} get={(r) => (r.gpPct * 100).toFixed(1) + '%'} dim />
              <PfRow label="GP Income" rows={rows} get={(r) => fmt(r.gpIncome)} />
              <PfRow label="Investor Cash Flow" rows={rows} get={(r) => fmt(r.investorCashFlow)} strong />
              <PfRow label="Investor ROI (Cash-on-Cash)" rows={rows} get={(r) => (r.investorROI == null ? '—' : (r.investorROI * 100).toFixed(2) + '%')} dim />
              <PfRow label="Cap Rate" rows={rows} get={(r) => (r.capRate == null ? '—' : (r.capRate * 100).toFixed(2) + '%')} dim />
            </tbody>
          </table>
        </div>
        <p className="explainer" style={{ marginTop: 12 }}>
          GP allocation ramps from 10% (year 1) to the cap (Settings, default 20%) by year 5, then holds. ROI is measured on Total Operating Capital &amp; Closing.
        </p>
      </section>

      <section className="panel">
        <h2>Sale & Investor Returns</h2>
        <div className="pf-scroll">
          <table className="pf-grid">
            <thead>
              <tr>
                <th className="rowlabel">Line</th>
                {rows.map((r) => (
                  <th key={r.year} className={r.regime === 'refi' ? 'refi-col' : ''}>
                    Yr {r.year}
                    {refiYearNum && r.year === refiYearNum && <span className="refi-tag">refi</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PfRow label="Break-Even Occupancy" rows={rows} get={(r) => (r.breakEvenOcc == null ? '—' : (r.breakEvenOcc * 100).toFixed(1) + '%')} dim />
              <PfRow label="Total Value at CAP" rows={rows} get={(r) => fmt(r.totalValueAtCap)} strong />
              <PfRow label="Price per SF (at value)" rows={rows} get={(r) => (r.valuePricePerSF ? '$' + r.valuePricePerSF.toFixed(0) : '—')} dim />
              <PfRow label="Net Sale Proceeds" rows={rows} get={(r) => fmt(r.netSaleProceeds)} />
              <PfRow label="Payoff Loan" rows={rows} get={(r) => fmt(r.loanPayoff)} dim />
              <PfRow label="Mezz Payout" rows={rows} get={(r) => fmt(r.mezzPayoff)} dim />
              <PfRow label="Capital Accounts" rows={rows} get={(r) => fmt(r.capitalAccounts)} dim />
              <PfRow label="Total Profit from Sale" rows={rows} get={(r) => fmt(r.totalProfitFromSale)} strong />
              <PfRow label="Investor Share of Profit" rows={rows} get={(r) => fmt(r.investorShareOfProfit)} />
              <PfRow label="Investor Return (from sale)" rows={rows} get={(r) => (r.investorReturnFromSale == null ? '—' : (r.investorReturnFromSale * 100).toFixed(1) + '%')} dim />
              <PfRow label="Distributions (accumulated)" rows={rows} get={(r) => fmt(r.accumulatedDistributions)} />
              <PfRow label="Investor Total Return" rows={rows} get={(r) => (r.investorTotalReturn == null ? '—' : (r.investorTotalReturn * 100).toFixed(1) + '%')} strong />
              <PfRow label="Annualized Return" rows={rows} get={(r) => (r.annualizedReturn == null ? '—' : (r.annualizedReturn * 100).toFixed(1) + '%')} dim />
            </tbody>
          </table>
        </div>
        <p className="explainer" style={{ marginTop: 12 }}>
          Net Sale Proceeds = Total Value at CAP × (100% − sales commission, Settings). Capital Accounts = Total for Closing. Investor share = (100% − max GP) of sale profit. Distributions accumulate investor cash flow year over year.
        </p>
      </section>
    </>
  );
}

function PfRow({ label, rows, get, strong, dim }) {
  return (
    <tr className={strong ? 'pf-strong' : dim ? 'pf-dim' : ''}>
      <td className="rowlabel">{label}</td>
      {rows.map((r) => (
        <td key={r.year} className={r.regime === 'refi' ? 'refi-col' : ''}>{get(r)}</td>
      ))}
    </tr>
  );
}

function PfRowInput({ label, rows, values, onChange }) {
  return (
    <tr className="pf-input-row">
      <td className="rowlabel">{label}</td>
      {rows.map((r, i) => (
        <td key={r.year} className={r.regime === 'refi' ? 'refi-col' : ''}>
          <input
            className="pf-cell-input"
            type="text"
            inputMode="decimal"
            value={values[i]}
            onChange={(e) => onChange(i, e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
          />
        </td>
      ))}
    </tr>
  );
}

function Field({ label, note, children }) {
  return (
    <label className="field">
      <span className="flabel">{label}</span>
      {children}
      {note && <span className="calc-note">{note}</span>}
    </label>
  );
}

// A per-SF default in Settings.
function PsfField({ label, k, psf, setPsf }) {
  return (
    <div className="field">
      <span className="flabel">{label}</span>
      <Num value={psf[k]} onChange={(v) => setPsf(k, v)} prefix="$" suffix="/SF" />
    </div>
  );
}

// A labeled sub-group of line items with a running subtotal.
function SubGroup({ title, subtotal, children }) {
  return (
    <div className="subgroup">
      <div className="subgroup-head">
        <span className="subgroup-title">{title}</span>
        <span className="subgroup-subtotal">{usd(subtotal)}</span>
      </div>
      <div className="subgroup-lines">{children}</div>
    </div>
  );
}

// A single Operating-Capital/Closing line: label + computed (read-only) $ value.
function OccField({ label, value, note }) {
  return (
    <div className="occ-line">
      <span className="occ-label">{label}{note && <span className="occ-note"> · {note}</span>}</span>
      <Num value={Math.round(value)} prefix="$" calc />
    </div>
  );
}

// Manual variant removed — Acquisition Fee is now computed (circular 3%).


// Numeric input. When `calc` is set it's read-only (an automatic calculation),
// shown with a dashed gold-tinted box and comma formatting.
function Num({ value, onChange, prefix, suffix, calc, emph }) {
  return (
    <div className={`numwrap ${calc ? 'calc' : ''} ${emph ? 'emph' : ''}`}>
      {prefix && <span className="affix">{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        disabled={calc}
        // Calculated fields are comma-formatted for readability. Editable
        // fields show the raw text so decimals (e.g. "3.5") can be typed.
        value={calc ? commas(value) : (value === '' || value == null ? '' : value)}
        onChange={(e) => {
          if (calc || !onChange) return;
          // Allow digits and a single decimal point.
          let raw = e.target.value.replace(/[^0-9.]/g, '');
          const firstDot = raw.indexOf('.');
          if (firstDot !== -1) {
            raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
          }
          onChange(raw);
        }}
      />
      {suffix && <span className="affix">{suffix}</span>}
    </div>
  );
}
