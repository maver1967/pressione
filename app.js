/**
 * CardioPulse Pro - Core Application Logic
 * Standard Clinici ESH/ESC (European Society of Hypertension) & AHA
 */

// --- ESH/ESC Clinical Category Definitions ---
const BP_CATEGORIES = {
    optimal: {
        key: 'optimal',
        name: 'Normotensione Ottimale',
        badgeClass: 'badge-optimal',
        color: '#10b981',
        description: 'Pressione ideale (< 120 e < 80 mmHg).'
    },
    normal: {
        key: 'normal',
        name: 'Normotensione',
        badgeClass: 'badge-normal',
        color: '#14b8a6',
        description: 'Valori normali e desiderabili (120-129 / 80-84 mmHg).'
    },
    high_normal: {
        key: 'high_normal',
        name: 'Normal-Alta',
        badgeClass: 'badge-high_normal',
        color: '#eab308',
        description: 'Pressione al limite superiore (130-139 / 85-89 mmHg).'
    },
    stage1: {
        key: 'stage1',
        name: 'Ipertensione Grado 1',
        badgeClass: 'badge-stage1',
        color: '#f97316',
        description: 'Ipertensione lieve (140-159 / 90-99 mmHg).'
    },
    stage2: {
        key: 'stage2',
        name: 'Ipertensione Grado 2',
        badgeClass: 'badge-stage2',
        color: '#ef4444',
        description: 'Ipertensione moderata (160-179 / 100-109 mmHg).'
    },
    stage3: {
        key: 'stage3',
        name: 'Ipertensione Grado 3',
        badgeClass: 'badge-stage3',
        color: '#dc2626',
        description: 'Ipertensione severa (≥ 180 / ≥ 110 mmHg).'
    }
};

// --- Application State ---
class CardioPulseApp {
    constructor() {
        this.readings = [];
        this.currentPeriod = 7; // days or 'all'
        this.editingId = null;
        this.selectedTags = new Set();
        this.selectedTod = 'Mattina';
        
        // Chart instances
        this.charts = {
            dashTrend: null,
            dashDonut: null,
            fullTrend: null,
            todBar: null
        };

        this.init();
    }

    init() {
        this.loadStorage();
        this.bindEvents();
        this.initTheme();
        this.renderAll();
    }

    // --- LocalStorage Operations ---
    loadStorage() {
        try {
            const raw = localStorage.getItem('cardiopulse_readings');
            this.readings = raw ? JSON.parse(raw) : [];

            // Load saved Google Sheets URL
            this.sheetsUrl = localStorage.getItem('cardiopulse_sheets_url') || '';
            const urlInput = document.getElementById('sheets-web-url');
            if (urlInput && this.sheetsUrl) urlInput.value = this.sheetsUrl;

            // Load saved report info
            const pInfo = localStorage.getItem('cardiopulse_patient');
            if (pInfo) {
                const info = JSON.parse(pInfo);
                document.getElementById('rep-patient-name').value = info.name || '';
                document.getElementById('rep-patient-dob').value = info.dob || '';
                document.getElementById('rep-doctor-name').value = info.doctor || '';
                document.getElementById('rep-medications').value = info.meds || '';
            }

            // Sync from Google Sheets if URL configured
            if (this.sheetsUrl) {
                this.fetchFromGoogleSheets(false);
            }
        } catch (e) {
            console.error('Error loading LocalStorage', e);
            this.readings = [];
        }
    }

    saveStorage() {
        localStorage.setItem('cardiopulse_readings', JSON.stringify(this.readings));
    }

    savePatientInfo() {
        const info = {
            name: document.getElementById('rep-patient-name').value,
            dob: document.getElementById('rep-patient-dob').value,
            doctor: document.getElementById('rep-doctor-name').value,
            meds: document.getElementById('rep-medications').value
        };
        localStorage.setItem('cardiopulse_patient', JSON.stringify(info));
        this.updateReportPrintableHeader();
    }

    // --- Clinical Category Logic (ESH/ESC) ---
    classifyReading(sys, dia) {
        sys = Number(sys);
        dia = Number(dia);

        if (sys >= 180 || dia >= 110) return BP_CATEGORIES.stage3;
        if (sys >= 160 || dia >= 100) return BP_CATEGORIES.stage2;
        if (sys >= 140 || dia >= 90) return BP_CATEGORIES.stage1;
        if ((sys >= 130 && sys <= 139) || (dia >= 85 && dia <= 89)) return BP_CATEGORIES.high_normal;
        if ((sys >= 120 && sys <= 129) || (dia >= 80 && dia <= 84)) return BP_CATEGORIES.normal;
        return BP_CATEGORIES.optimal;
    }

    calculateMAP(sys, dia) {
        // Mean Arterial Pressure = DIA + 1/3 (SYS - DIA)
        return Math.round(dia + (sys - dia) / 3);
    }

    calculatePulsePressure(sys, dia) {
        // dPP = SYS - DIA
        return sys - dia;
    }

    // --- Event Handlers & Binding ---
    bindEvents() {
        // Navigation Tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const target = e.currentTarget.dataset.target;
                this.switchTab(target);
            });
        });

        // Theme Toggle
        document.getElementById('btn-theme-toggle').addEventListener('click', () => this.toggleTheme());

        // Quick Add Modal Trigger
        document.getElementById('btn-quick-add').addEventListener('click', () => this.openEntryModal());
        document.getElementById('empty-add-btn')?.addEventListener('click', () => this.openEntryModal());
        document.getElementById('btn-close-modal').addEventListener('click', () => this.closeEntryModal());
        document.getElementById('btn-cancel-modal').addEventListener('click', () => this.closeEntryModal());

        // Google Sheets Modal Triggers
        document.getElementById('btn-open-sheets-modal')?.addEventListener('click', () => this.openSheetsModal());
        document.getElementById('btn-close-sheets-modal')?.addEventListener('click', () => this.closeSheetsModal());
        document.getElementById('btn-save-sheets-url')?.addEventListener('click', () => this.saveSheetsUrl());
        document.getElementById('btn-sync-now')?.addEventListener('click', () => this.fetchFromGoogleSheets(true));

        // Dropdown Menu Toggle
        const dropdownBtn = document.getElementById('menu-dropdown-btn');
        const dropdown = dropdownBtn.closest('.dropdown');
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });
        document.addEventListener('click', () => dropdown.classList.remove('open'));

        // Form Submit
        document.getElementById('form-entry').addEventListener('submit', (e) => this.handleFormSubmit(e));

        // Form Steppers (+1, -1, +5, -5)
        document.querySelectorAll('.btn-step, .btn-chip').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleStepperClick(e));
        });

        // Live inputs preview in modal
        ['entry-sys', 'entry-dia'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.updateModalLivePreview());
        });

        // Auto Time-of-Day calculation when time input changes
        document.getElementById('entry-time').addEventListener('change', (e) => {
            this.autoSelectTOD(e.target.value);
        });

        // Time-of-Day button selector
        document.querySelectorAll('.tod-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tod-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.selectedTod = e.currentTarget.dataset.value;
            });
        });

        // Quick Tags Cloud
        document.querySelectorAll('.tag-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const tag = e.currentTarget.dataset.tag;
                if (this.selectedTags.has(tag)) {
                    this.selectedTags.delete(tag);
                    e.currentTarget.classList.remove('active');
                } else {
                    this.selectedTags.add(tag);
                    e.currentTarget.classList.add('active');
                }
            });
        });

        // Dashboard Period Filters
        document.querySelectorAll('.btn-filter').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.currentPeriod = e.currentTarget.dataset.period === 'all' ? 'all' : Number(e.currentTarget.dataset.period);
                this.renderAll();
            });
        });

        // History Table Search & Filters
        document.getElementById('table-search').addEventListener('input', () => this.renderHistoryTable());
        document.getElementById('filter-category-select').addEventListener('change', () => this.renderHistoryTable());
        document.getElementById('filter-tod-select').addEventListener('change', () => this.renderHistoryTable());

        // Backup & Demo Actions
        document.getElementById('btn-export-csv').addEventListener('click', () => this.exportCSV());
        document.getElementById('btn-export-json').addEventListener('click', () => this.exportJSON());
        document.getElementById('input-import-json').addEventListener('change', (e) => this.importJSON(e));
        document.getElementById('btn-load-demo').addEventListener('click', () => {
            if (confirm('Caricare le misurazioni di esempio?')) {
                this.seedDemoData();
                this.renderAll();
                this.showToast('Dati demo caricati con successo!');
            }
        });
        document.getElementById('btn-clear-all').addEventListener('click', () => {
            if (confirm('ATTENZIONE: Sei sicuro di voler cancellare TUTTE le misurazioni salvate? L\'operazione non è reversibile.')) {
                this.readings = [];
                this.saveStorage();
                this.renderAll();
                this.showToast('Tutte le misurazioni sono state cancellate.');
            }
        });

        // Report Patient Info Inputs
        ['rep-patient-name', 'rep-patient-dob', 'rep-doctor-name', 'rep-medications'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.savePatientInfo());
        });

        // Print Trigger
        document.getElementById('btn-trigger-print').addEventListener('click', () => {
            window.print();
        });
    }

    // --- Tab Navigation ---
    switchTab(tabId) {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));

        document.querySelector(`.nav-tab[data-target="${tabId}"]`)?.classList.add('active');
        const activePage = document.getElementById(tabId);
        if (activePage) {
            activePage.classList.add('active');
        }

        // Re-render charts when switching to chart tab to handle dynamic canvas resize
        if (tabId === 'tab-charts' || tabId === 'tab-dashboard') {
            setTimeout(() => this.renderCharts(), 50);
        }
    }

    // --- Theme Management ---
    initTheme() {
        const savedTheme = localStorage.getItem('cardiopulse_theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('cardiopulse_theme', next);
        this.renderCharts(); // Redraw chart colors
    }

    // --- Stepper Controls ---
    handleStepperClick(e) {
        const btn = e.currentTarget;
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (!input) return;

        let val = Number(input.value) || 0;
        const action = btn.dataset.action;

        if (action === 'inc') val += Number(btn.dataset.step || 1);
        else if (action === 'dec') val -= Number(btn.dataset.step || 1);
        else if (action === 'add') val += Number(btn.dataset.val || 0);

        // Clamp values
        const min = Number(input.min) || 30;
        const max = Number(input.max) || 260;
        val = Math.max(min, Math.min(max, val));

        input.value = val;
        this.updateModalLivePreview();
    }

    autoSelectTOD(timeStr) {
        if (!timeStr) return;
        const hours = parseInt(timeStr.split(':')[0], 10);
        let tod = 'Mattina';
        if (hours >= 6 && hours < 12) tod = 'Mattina';
        else if (hours >= 12 && hours < 18) tod = 'Pomeriggio';
        else if (hours >= 18 && hours < 24) tod = 'Sera';
        else tod = 'Notte';

        this.selectedTod = tod;
        document.querySelectorAll('.tod-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === tod);
        });
    }

    updateModalLivePreview() {
        const sys = Number(document.getElementById('entry-sys').value) || 120;
        const dia = Number(document.getElementById('entry-dia').value) || 80;
        const cat = this.classifyReading(sys, dia);

        const badge = document.getElementById('modal-badge-text');
        badge.textContent = `${sys} / ${dia} mmHg — ${cat.name}`;
        badge.className = `live-badge ${cat.badgeClass}`;
    }

    // --- Modal Actions ---
    openEntryModal(editingItem = null) {
        const modal = document.getElementById('modal-entry');
        const form = document.getElementById('form-entry');
        form.reset();
        this.selectedTags.clear();
        document.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('active'));

        const now = new Date();
        const currentDateStr = now.toISOString().split('T')[0];
        const currentTimeStr = now.toTimeString().substring(0, 5);

        if (editingItem) {
            this.editingId = editingItem.id;
            document.getElementById('modal-title').textContent = 'Modifica Misurazione';
            document.getElementById('entry-id').value = editingItem.id;
            document.getElementById('entry-sys').value = editingItem.sys;
            document.getElementById('entry-dia').value = editingItem.dia;
            document.getElementById('entry-pulse').value = editingItem.pulse;
            document.getElementById('entry-date').value = editingItem.date;
            document.getElementById('entry-time').value = editingItem.time;
            document.getElementById('entry-arm').value = editingItem.arm || 'Sinistro';
            document.getElementById('entry-position').value = editingItem.position || 'Seduto';
            document.getElementById('entry-notes').value = editingItem.notes || '';

            this.selectedTod = editingItem.tod || 'Mattina';
            (editingItem.tags || []).forEach(t => this.selectedTags.add(t));

            document.querySelectorAll('.tag-chip').forEach(c => {
                if (this.selectedTags.has(c.dataset.tag)) c.classList.add('active');
            });
        } else {
            this.editingId = null;
            document.getElementById('modal-title').textContent = 'Nuova Misurazione Pressione';
            document.getElementById('entry-id').value = '';
            document.getElementById('entry-sys').value = 120;
            document.getElementById('entry-dia').value = 80;
            document.getElementById('entry-pulse').value = 72;
            document.getElementById('entry-date').value = currentDateStr;
            document.getElementById('entry-time').value = currentTimeStr;
            this.autoSelectTOD(currentTimeStr);
        }

        document.querySelectorAll('.tod-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.value === this.selectedTod);
        });

        this.updateModalLivePreview();
        modal.classList.remove('hidden');
    }

    closeEntryModal() {
        document.getElementById('modal-entry').classList.add('hidden');
    }

    handleFormSubmit(e) {
        e.preventDefault();
        const sys = Number(document.getElementById('entry-sys').value);
        const dia = Number(document.getElementById('entry-dia').value);
        const pulse = Number(document.getElementById('entry-pulse').value);
        const date = document.getElementById('entry-date').value;
        const time = document.getElementById('entry-time').value;
        const arm = document.getElementById('entry-arm').value;
        const position = document.getElementById('entry-position').value;
        const notes = document.getElementById('entry-notes').value.trim();

        if (sys <= dia) {
            alert('La Sistolica (Massima) deve essere superiore alla Diastolica (Minima).');
            return;
        }

        const readingData = {
            id: this.editingId || 'bp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            timestamp: new Date(`${date}T${time}`).getTime(),
            date,
            time,
            tod: this.selectedTod,
            sys,
            dia,
            pulse,
            arm,
            position,
            notes,
            tags: Array.from(this.selectedTags)
        };

        if (this.editingId) {
            const index = this.readings.findIndex(r => r.id === this.editingId);
            if (index !== -1) this.readings[index] = readingData;
        } else {
            this.readings.unshift(readingData);
        }

        // Sort by timestamp desc
        this.readings.sort((a, b) => b.timestamp - a.timestamp);

        this.saveStorage();
        this.closeEntryModal();
        this.renderAll();
        
        // Sync to Google Sheets if configured
        if (this.sheetsUrl) {
            this.postToGoogleSheets(readingData);
        }

        this.showToast(this.editingId ? 'Misurazione aggiornata!' : 'Nuova misurazione salvata!');
    }

    // --- GOOGLE SHEETS SYNC METHODS ---
    openSheetsModal() {
        document.getElementById('modal-sheets')?.classList.remove('hidden');
    }

    closeSheetsModal() {
        document.getElementById('modal-sheets')?.classList.add('hidden');
    }

    saveSheetsUrl() {
        const url = document.getElementById('sheets-web-url').value.trim();
        this.sheetsUrl = url;
        localStorage.setItem('cardiopulse_sheets_url', url);
        this.closeSheetsModal();
        if (url) {
            this.fetchFromGoogleSheets(true);
        } else {
            this.showToast('URL Google Sheets rimosso.');
        }
    }

    fetchFromGoogleSheets(showToastNotice = true) {
        if (!this.sheetsUrl) return;

        fetch(this.sheetsUrl)
            .then(res => res.json())
            .then(remoteData => {
                if (Array.isArray(remoteData) && remoteData.length > 0) {
                    const existingIds = new Set(this.readings.map(r => r.id));
                    let addedCount = 0;

                    remoteData.forEach(item => {
                        if (item.id && !existingIds.has(item.id)) {
                            let cleanDate = String(item.date || '');
                            if (cleanDate.includes('T')) cleanDate = cleanDate.split('T')[0];

                            let cleanTime = String(item.time || '');
                            if (cleanTime.includes('T')) {
                                const timePart = cleanTime.split('T')[1];
                                if (timePart) cleanTime = timePart.substring(0, 5);
                            } else {
                                cleanTime = cleanTime.substring(0, 5);
                            }

                            this.readings.push({
                                id: String(item.id),
                                timestamp: Number(item.timestamp) || new Date(`${cleanDate}T${cleanTime}`).getTime() || Date.now(),
                                date: cleanDate,
                                time: cleanTime,
                                tod: String(item.tod || 'Mattina'),
                                sys: Number(item.sys),
                                dia: Number(item.dia),
                                pulse: Number(item.pulse),
                                arm: String(item.arm || ''),
                                position: String(item.position || ''),
                                notes: String(item.notes || ''),
                                tags: Array.isArray(item.tags) ? item.tags : []
                            });
                            addedCount++;
                        }
                    });

                    if (addedCount > 0) {
                        this.readings.sort((a, b) => b.timestamp - a.timestamp);
                        this.saveStorage();
                        this.renderAll();
                    }
                    if (showToastNotice) {
                        this.showToast(`Sincronizzazione completata: ${addedCount} nuove misurazioni.`);
                    }
                } else if (showToastNotice) {
                    this.showToast('Google Sheets sincronizzato: Nessun nuovo dato.');
                }
            })
            .catch(err => {
                console.error('Errore sincronizzazione Google Sheets:', err);
                if (showToastNotice) {
                    this.showToast('Errore durante la sincronizzazione con Google Sheets.');
                }
            });
    }

    postToGoogleSheets(readingData) {
        if (!this.sheetsUrl) return;

        fetch(this.sheetsUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(readingData)
        })
        .then(() => {
            this.showToast('Inviato a Google Sheets ☁️');
        })
        .catch(err => console.error('Errore invio a Google Sheets:', err));
    }

    deleteReading(id) {
        if (confirm('Eliminare questa misurazione?')) {
            this.readings = this.readings.filter(r => r.id !== id);
            this.saveStorage();
            this.renderAll();
            this.showToast('Misurazione eliminata.');
        }
    }

    // --- Filtered Readings Helper ---
    getFilteredReadings() {
        if (this.currentPeriod === 'all') return [...this.readings];
        const cutoff = Date.now() - (this.currentPeriod * 24 * 60 * 60 * 1000);
        return this.readings.filter(r => r.timestamp >= cutoff);
    }

    // --- RENDER ALL SECTIONS ---
    renderAll() {
        const filtered = this.getFilteredReadings();

        this.renderKPIs(filtered);
        this.renderCharts(filtered);
        this.renderHistoryTable();
        this.renderStatsSummary(filtered);
        this.updateReportPrintable(filtered);
        this.checkCrisisAlert();

        // Update Nav Badge
        document.getElementById('total-count-badge').textContent = this.readings.length;
    }

    // --- RENDER KPIS ---
    renderKPIs(filtered) {
        // 1. Latest Reading
        const latest = this.readings[0];
        if (latest) {
            document.getElementById('latest-sys').textContent = latest.sys;
            document.getElementById('latest-dia').textContent = latest.dia;
            document.getElementById('latest-pulse').textContent = latest.pulse;
            document.getElementById('latest-time').textContent = `${latest.date} ${latest.time} (${latest.tod})`;

            const cat = this.classifyReading(latest.sys, latest.dia);
            const badge = document.getElementById('latest-category-badge');
            badge.textContent = cat.name;
            badge.className = `category-badge ${cat.badgeClass}`;
        } else {
            document.getElementById('latest-sys').textContent = '--';
            document.getElementById('latest-dia').textContent = '--';
            document.getElementById('latest-pulse').textContent = '--';
            document.getElementById('latest-time').textContent = '--';
            document.getElementById('latest-category-badge').textContent = 'Nessun Dato Inserito';
            document.getElementById('latest-category-badge').className = 'category-badge';
        }

        // 2. Period Averages
        document.querySelectorAll('.period-text').forEach(el => {
            el.textContent = this.currentPeriod === 'all' ? 'Tutte' : `${this.currentPeriod} giorni`;
        });

        if (filtered.length > 0) {
            const sumSys = filtered.reduce((acc, r) => acc + r.sys, 0);
            const sumDia = filtered.reduce((acc, r) => acc + r.dia, 0);
            const sumPulse = filtered.reduce((acc, r) => acc + r.pulse, 0);

            const avgSys = Math.round(sumSys / filtered.length);
            const avgDia = Math.round(sumDia / filtered.length);
            const avgPulse = Math.round(sumPulse / filtered.length);

            document.getElementById('avg-sys').textContent = avgSys;
            document.getElementById('avg-dia').textContent = avgDia;
            document.getElementById('avg-pulse').textContent = avgPulse;

            const avgCat = this.classifyReading(avgSys, avgDia);
            document.getElementById('avg-category-desc').textContent = `Media del periodo: ${avgCat.name}`;

            // PAM & dPP
            const dPP = this.calculatePulsePressure(avgSys, avgDia);
            const map = this.calculateMAP(avgSys, avgDia);
            document.getElementById('pp-val').innerHTML = `${dPP} <small>mmHg</small>`;
            document.getElementById('map-val').innerHTML = `${map} <small>mmHg</small>`;

            // 3. Morning vs Evening
            const morningReadings = filtered.filter(r => r.tod === 'Mattina');
            const eveningReadings = filtered.filter(r => r.tod === 'Sera');

            if (morningReadings.length > 0) {
                const mSys = Math.round(morningReadings.reduce((a, r) => a + r.sys, 0) / morningReadings.length);
                const mDia = Math.round(morningReadings.reduce((a, r) => a + r.dia, 0) / morningReadings.length);
                document.getElementById('morning-avg').textContent = `${mSys} / ${mDia}`;
            } else {
                document.getElementById('morning-avg').textContent = '-- / --';
            }

            if (eveningReadings.length > 0) {
                const eSys = Math.round(eveningReadings.reduce((a, r) => a + r.sys, 0) / eveningReadings.length);
                const eDia = Math.round(eveningReadings.reduce((a, r) => a + r.dia, 0) / eveningReadings.length);
                document.getElementById('evening-avg').textContent = `${eSys} / ${eDia}`;
            } else {
                document.getElementById('evening-avg').textContent = '-- / --';
            }

        } else {
            document.getElementById('avg-sys').textContent = '--';
            document.getElementById('avg-dia').textContent = '--';
            document.getElementById('avg-pulse').textContent = '--';
            document.getElementById('avg-category-desc').textContent = 'Nessun dato nel periodo';
            document.getElementById('pp-val').innerHTML = `-- <small>mmHg</small>`;
            document.getElementById('map-val').innerHTML = `-- <small>mmHg</small>`;
            document.getElementById('morning-avg').textContent = '-- / --';
            document.getElementById('evening-avg').textContent = '-- / --';
        }
    }

    // --- CRISIS WARNING BANNER ---
    checkCrisisAlert() {
        const crisis = this.readings.find(r => r.sys >= 180 || r.dia >= 120);
        const banner = document.getElementById('alert-crisis-banner');
        if (crisis) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }

    // --- RENDER CHARTS ---
    renderCharts(filtered = this.getFilteredReadings()) {
        const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);

        const labels = sorted.map(r => {
            const d = (r.date || '').split('T')[0];
            const t = (r.time || '').split('T')[0].substring(0, 5);
            return `${d.length > 5 ? d.substring(5) : d} ${t}`;
        });
        const sysData = sorted.map(r => r.sys);
        const diaData = sorted.map(r => r.dia);
        const pulseData = sorted.map(r => r.pulse);

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
        const textColor = isDark ? '#94a3b8' : '#475569';

        // 1. Dashboard Trend Line Chart
        const ctxDash = document.getElementById('dashboardTrendChart')?.getContext('2d');
        if (ctxDash) {
            if (this.charts.dashTrend) this.charts.dashTrend.destroy();
            this.charts.dashTrend = new Chart(ctxDash, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'SYS (Massima)',
                            data: sysData,
                            borderColor: '#38bdf8',
                            backgroundColor: 'rgba(56, 189, 248, 0.1)',
                            borderWidth: 2.5,
                            tension: 0.3,
                            fill: true,
                            pointRadius: 4,
                            pointHoverRadius: 6
                        },
                        {
                            label: 'DIA (Minima)',
                            data: diaData,
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            borderWidth: 2.5,
                            tension: 0.3,
                            fill: true,
                            pointRadius: 4,
                            pointHoverRadius: 6
                        },
                        {
                            label: 'Pulsazioni (BPM)',
                            data: pulseData,
                            borderColor: '#f43f5e',
                            borderWidth: 1.5,
                            borderDash: [4, 4],
                            tension: 0.3,
                            pointRadius: 2
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
                        y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 11 } }, min: 40, max: 200 }
                    },
                    plugins: {
                        legend: { display: false }
                    }
                }
            });
        }

        // 2. Dashboard Donut Chart (Categories)
        const ctxDonut = document.getElementById('dashboardDonutChart')?.getContext('2d');
        if (ctxDonut) {
            const counts = {
                optimal: 0, normal: 0, high_normal: 0, stage1: 0, stage2: 0, stage3: 0
            };
            filtered.forEach(r => {
                const cat = this.classifyReading(r.sys, r.dia);
                counts[cat.key]++;
            });

            if (this.charts.dashDonut) this.charts.dashDonut.destroy();
            this.charts.dashDonut = new Chart(ctxDonut, {
                type: 'doughnut',
                data: {
                    labels: Object.values(BP_CATEGORIES).map(c => c.name),
                    datasets: [{
                        data: Object.keys(BP_CATEGORIES).map(k => counts[k]),
                        backgroundColor: Object.values(BP_CATEGORIES).map(c => c.color),
                        borderWidth: 2,
                        borderColor: isDark ? '#17203b' : '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: textColor, font: { size: 10 }, boxWidth: 12 } }
                    }
                }
            });
        }

        // 3. Full Detailed Trend Chart (Tab 2)
        const ctxFull = document.getElementById('fullTrendChart')?.getContext('2d');
        if (ctxFull) {
            if (this.charts.fullTrend) this.charts.fullTrend.destroy();
            this.charts.fullTrend = new Chart(ctxFull, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'SYS (Massima)',
                            data: sysData,
                            borderColor: '#38bdf8',
                            backgroundColor: 'rgba(56, 189, 248, 0.15)',
                            borderWidth: 3,
                            tension: 0.35,
                            fill: true,
                            pointRadius: 5
                        },
                        {
                            label: 'DIA (Minima)',
                            data: diaData,
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.15)',
                            borderWidth: 3,
                            tension: 0.35,
                            fill: true,
                            pointRadius: 5
                        },
                        {
                            label: 'Pulsazioni (BPM)',
                            data: pulseData,
                            borderColor: '#f43f5e',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            tension: 0.3,
                            pointRadius: 3
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { color: gridColor }, ticks: { color: textColor } },
                        y: { grid: { color: gridColor }, ticks: { color: textColor } }
                    },
                    plugins: {
                        legend: { position: 'top', labels: { color: textColor, font: { size: 12, weight: 'bold' } } }
                    }
                }
            });
        }

        // 4. Time of Day Comparison Bar Chart
        const ctxTod = document.getElementById('todBarChart')?.getContext('2d');
        if (ctxTod) {
            const todOrder = ['Mattina', 'Pomeriggio', 'Sera', 'Notte'];
            const todSys = todOrder.map(tod => {
                const arr = filtered.filter(r => r.tod === tod);
                return arr.length ? Math.round(arr.reduce((a, r) => a + r.sys, 0) / arr.length) : 0;
            });
            const todDia = todOrder.map(tod => {
                const arr = filtered.filter(r => r.tod === tod);
                return arr.length ? Math.round(arr.reduce((a, r) => a + r.dia, 0) / arr.length) : 0;
            });

            if (this.charts.todBar) this.charts.todBar.destroy();
            this.charts.todBar = new Chart(ctxTod, {
                type: 'bar',
                data: {
                    labels: ['☀️ Mattina', '🌤️ Pomeriggio', '🌙 Sera', '🌌 Notte'],
                    datasets: [
                        { label: 'SYS Media', data: todSys, backgroundColor: '#38bdf8', borderRadius: 6 },
                        { label: 'DIA Media', data: todDia, backgroundColor: '#10b981', borderRadius: 6 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { display: false }, ticks: { color: textColor } },
                        y: { grid: { color: gridColor }, ticks: { color: textColor }, min: 50, max: 180 }
                    },
                    plugins: {
                        legend: { position: 'top', labels: { color: textColor } }
                    }
                }
            });
        }
    }

    // --- RENDER STATS SUMMARY (Tab 2) ---
    renderStatsSummary(filtered) {
        const container = document.getElementById('stats-summary-list');
        if (!container) return;

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state">Nessun dato nel periodo selezionato.</div>';
            return;
        }

        const sysArr = filtered.map(r => r.sys);
        const diaArr = filtered.map(r => r.dia);
        const pulseArr = filtered.map(r => r.pulse);

        const maxSys = Math.max(...sysArr);
        const minSys = Math.min(...sysArr);
        const maxDia = Math.max(...diaArr);
        const minDia = Math.min(...diaArr);
        const maxPulse = Math.max(...pulseArr);
        const minPulse = Math.min(...pulseArr);

        // Standard Deviation of SYS
        const avgSys = sysArr.reduce((a, b) => a + b, 0) / sysArr.length;
        const sysVariance = sysArr.reduce((acc, v) => acc + Math.pow(v - avgSys, 2), 0) / sysArr.length;
        const sysSD = Math.sqrt(sysVariance).toFixed(1);

        container.innerHTML = `
            <div class="stat-item-row">
                <span class="stat-item-title">Sistolica Massima Rilevata:</span>
                <span class="stat-item-val text-danger">${maxSys} mmHg</span>
            </div>
            <div class="stat-item-row">
                <span class="stat-item-title">Sistolica Minima Rilevata:</span>
                <span class="stat-item-val text-success">${minSys} mmHg</span>
            </div>
            <div class="stat-item-row">
                <span class="stat-item-title">Diastolica Massima Rilevata:</span>
                <span class="stat-item-val text-danger">${maxDia} mmHg</span>
            </div>
            <div class="stat-item-row">
                <span class="stat-item-title">Diastolica Minima Rilevata:</span>
                <span class="stat-item-val text-success">${minDia} mmHg</span>
            </div>
            <div class="stat-item-row">
                <span class="stat-item-title">Frequenza Cardiaca (Min / Max):</span>
                <span class="stat-item-val">${minPulse} – ${maxPulse} BPM</span>
            </div>
            <div class="stat-item-row">
                <span class="stat-item-title">Variabilità Sistolica (Deviazione Std):</span>
                <span class="stat-item-val">± ${sysSD} mmHg</span>
            </div>
        `;
    }

    // --- RENDER HISTORY TABLE ---
    renderHistoryTable() {
        const tbody = document.getElementById('history-table-body');
        const emptyState = document.getElementById('table-empty-state');
        if (!tbody) return;

        const searchQuery = document.getElementById('table-search').value.toLowerCase();
        const categoryFilter = document.getElementById('filter-category-select').value;
        const todFilter = document.getElementById('filter-tod-select').value;

        const filtered = this.readings.filter(r => {
            const cat = this.classifyReading(r.sys, r.dia);

            if (categoryFilter !== 'all' && cat.key !== categoryFilter) return false;
            if (todFilter !== 'all' && r.tod !== todFilter) return false;

            if (searchQuery) {
                const combinedText = `${r.notes || ''} ${r.arm || ''} ${r.position || ''} ${(r.tags || []).join(' ')}`.toLowerCase();
                if (!combinedText.includes(searchQuery)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        tbody.innerHTML = filtered.map(r => {
            const cat = this.classifyReading(r.sys, r.dia);
            const tagsHtml = (r.tags || []).map(t => `<span class="table-tag">${t}</span>`).join('');

            return `
                <tr>
                    <td>
                        <strong>${r.date}</strong>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${r.time}</div>
                    </td>
                    <td><strong>${r.tod}</strong></td>
                    <td class="table-sys-dia">${r.sys} <small>mmHg</small></td>
                    <td class="table-sys-dia">${r.dia} <small>mmHg</small></td>
                    <td class="table-pulse">${r.pulse} <small>BPM</small></td>
                    <td><span class="category-badge ${cat.badgeClass}">${cat.name}</span></td>
                    <td>
                        <div>${r.arm ? r.arm : ''} ${r.position ? '(' + r.position + ')' : ''}</div>
                        ${tagsHtml}
                        ${r.notes ? `<div style="font-size:0.8rem; color:var(--text-secondary); font-style:italic; margin-top:2px;">"${r.notes}"</div>` : ''}
                    </td>
                    <td class="text-right">
                        <div class="action-btns">
                            <button class="btn-table-action" onclick="app.openEntryModal(${JSON.stringify(r).replace(/"/g, '&quot;')})" title="Modifica">
                                ✏️
                            </button>
                            <button class="btn-table-action delete" onclick="app.deleteReading('${r.id}')" title="Elimina">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // --- MEDICAL REPORT UPDATE ---
    updateReportPrintable(filtered = this.getFilteredReadings()) {
        const todayStr = new Date().toLocaleDateString('it-IT');
        document.getElementById('rep-gen-date').textContent = todayStr;

        this.updateReportPrintableHeader();

        // Summary stats
        document.getElementById('rep-stat-count').textContent = filtered.length;

        if (filtered.length > 0) {
            const avgSys = Math.round(filtered.reduce((a, r) => a + r.sys, 0) / filtered.length);
            const avgDia = Math.round(filtered.reduce((a, r) => a + r.dia, 0) / filtered.length);
            const avgBpm = Math.round(filtered.reduce((a, r) => a + r.pulse, 0) / filtered.length);

            document.getElementById('rep-stat-sys').textContent = `${avgSys} mmHg`;
            document.getElementById('rep-stat-dia').textContent = `${avgDia} mmHg`;
            document.getElementById('rep-stat-bpm').textContent = `${avgBpm} BPM`;
            document.getElementById('rep-stat-dpp').textContent = `${avgSys - avgDia} mmHg`;
            document.getElementById('rep-stat-pam').textContent = `${this.calculateMAP(avgSys, avgDia)} mmHg`;

            // Circadian
            const mList = filtered.filter(r => r.tod === 'Mattina');
            const eList = filtered.filter(r => r.tod === 'Sera');

            if (mList.length) {
                const ms = Math.round(mList.reduce((a, r) => a + r.sys, 0) / mList.length);
                const md = Math.round(mList.reduce((a, r) => a + r.dia, 0) / mList.length);
                document.getElementById('rep-circ-morning').textContent = `${ms} / ${md} mmHg (${mList.length} rilevazioni)`;
            } else {
                document.getElementById('rep-circ-morning').textContent = 'Nessun dato';
            }

            if (eList.length) {
                const es = Math.round(eList.reduce((a, r) => a + r.sys, 0) / eList.length);
                const ed = Math.round(eList.reduce((a, r) => a + r.dia, 0) / eList.length);
                document.getElementById('rep-circ-evening').textContent = `${es} / ${ed} mmHg (${eList.length} rilevazioni)`;
            } else {
                document.getElementById('rep-circ-evening').textContent = 'Nessun dato';
            }

        } else {
            document.getElementById('rep-stat-sys').textContent = '-- mmHg';
            document.getElementById('rep-stat-dia').textContent = '-- mmHg';
            document.getElementById('rep-stat-bpm').textContent = '-- BPM';
            document.getElementById('rep-stat-dpp').textContent = '-- mmHg';
            document.getElementById('rep-stat-pam').textContent = '-- mmHg';
            document.getElementById('rep-circ-morning').textContent = '--';
            document.getElementById('rep-circ-evening').textContent = '--';
        }

        // Printable Log Table
        const logTbody = document.getElementById('print-log-table-body');
        if (logTbody) {
            logTbody.innerHTML = filtered.map(r => {
                const cat = this.classifyReading(r.sys, r.dia);
                const tagsStr = (r.tags || []).join(', ');
                const fullNotes = [tagsStr, r.notes].filter(Boolean).join(' - ');

                return `
                    <tr>
                        <td><strong>${r.date}</strong> ${r.time}</td>
                        <td>${r.tod}</td>
                        <td><strong>${r.sys}</strong></td>
                        <td><strong>${r.dia}</strong></td>
                        <td>${r.pulse}</td>
                        <td>${cat.name}</td>
                        <td>${r.arm || 'Sinistro'} (${r.position || 'Seduto'})</td>
                        <td>${fullNotes || '-'}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    updateReportPrintableHeader() {
        document.getElementById('print-patient-name').textContent = document.getElementById('rep-patient-name').value || 'Non specificato';
        document.getElementById('print-patient-dob').textContent = document.getElementById('rep-patient-dob').value || '--';
        document.getElementById('print-doctor-name').textContent = document.getElementById('rep-doctor-name').value || '--';
        document.getElementById('print-medications').textContent = document.getElementById('rep-medications').value || 'Nessuna indicata';
    }

    // --- CSV EXPORT ---
    exportCSV() {
        if (this.readings.length === 0) {
            alert('Nessuna misurazione da esportare.');
            return;
        }

        const headers = ['Data', 'Ora', 'Fascia Oraria', 'Sistolica (SYS)', 'Diastolica (DIA)', 'Pulsazioni (BPM)', 'Stato Clinico', 'Braccio', 'Posizione', 'Tag', 'Note'];
        const rows = this.readings.map(r => {
            const cat = this.classifyReading(r.sys, r.dia);
            return [
                r.date,
                r.time,
                r.tod,
                r.sys,
                r.dia,
                r.pulse,
                `"${cat.name}"`,
                `"${r.arm || ''}"`,
                `"${r.position || ''}"`,
                `"${(r.tags || []).join('; ')}"`,
                `"${(r.notes || '').replace(/"/g, '""')}"`
            ].join(';');
        });

        // Add UTF-8 BOM for Microsoft Excel compatibility
        const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `pressione_arteriosa_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('Esportazione CSV completata!');
    }

    // --- JSON EXPORT / IMPORT ---
    exportJSON() {
        if (this.readings.length === 0) {
            alert('Nessun dato da esportare.');
            return;
        }

        const dataStr = JSON.stringify({
            version: '1.0',
            exportedAt: new Date().toISOString(),
            readings: this.readings,
            patientInfo: {
                name: document.getElementById('rep-patient-name').value,
                dob: document.getElementById('rep-patient-dob').value,
                doctor: document.getElementById('rep-doctor-name').value,
                meds: document.getElementById('rep-medications').value
            }
        }, null, 2);

        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_cardiopulse_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('Backup JSON scaricato!');
    }

    importJSON(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target.result);
                let importedReadings = [];

                if (Array.isArray(parsed)) {
                    importedReadings = parsed;
                } else if (parsed.readings && Array.isArray(parsed.readings)) {
                    importedReadings = parsed.readings;
                    if (parsed.patientInfo) {
                        document.getElementById('rep-patient-name').value = parsed.patientInfo.name || '';
                        document.getElementById('rep-patient-dob').value = parsed.patientInfo.dob || '';
                        document.getElementById('rep-doctor-name').value = parsed.patientInfo.doctor || '';
                        document.getElementById('rep-medications').value = parsed.patientInfo.meds || '';
                        this.savePatientInfo();
                    }
                }

                if (importedReadings.length === 0) {
                    alert('Il file di backup non contiene misurazioni valide.');
                    return;
                }

                // Merge with existing avoiding duplicate IDs
                const existingIds = new Set(this.readings.map(r => r.id));
                let addedCount = 0;

                importedReadings.forEach(item => {
                    if (!existingIds.has(item.id)) {
                        this.readings.push(item);
                        addedCount++;
                    }
                });

                this.readings.sort((a, b) => b.timestamp - a.timestamp);
                this.saveStorage();
                this.renderAll();
                this.showToast(`Importazione completata: aggiunte ${addedCount} nuove misurazioni!`);

            } catch (err) {
                alert('Errore nella lettura del file JSON: Formato non valido.');
                console.error(err);
            }
        };
        reader.readAsText(file);
    }

    // --- SEED DEMO DATA ---
    seedDemoData() {
        const demoReadings = [];
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;

        // Generate 20 realistic readings over the last 10 days (morning & evening)
        for (let i = 9; i >= 0; i--) {
            const baseDate = new Date(now - (i * dayMs));
            const dateStr = baseDate.toISOString().split('T')[0];

            // Morning measurement (e.g. 07:30)
            const mSys = Math.floor(118 + Math.random() * 22); // 118-140
            const mDia = Math.floor(74 + Math.random() * 14);  // 74-88
            const mBpm = Math.floor(62 + Math.random() * 16);  // 62-78

            demoReadings.push({
                id: `demo_m_${i}`,
                timestamp: new Date(`${dateStr}T07:30:00`).getTime(),
                date: dateStr,
                time: '07:30',
                tod: 'Mattina',
                sys: mSys,
                dia: mDia,
                pulse: mBpm,
                arm: 'Sinistro',
                position: 'Seduto',
                notes: i % 3 === 0 ? 'Prima di colazione' : 'A riposo',
                tags: ['A riposo', 'Prima di mangiare']
            });

            // Evening measurement (e.g. 19:45)
            const eSys = Math.floor(122 + Math.random() * 25); // 122-147
            const eDia = Math.floor(78 + Math.random() * 15);  // 78-93
            const eBpm = Math.floor(68 + Math.random() * 18);  // 68-86

            demoReadings.push({
                id: `demo_e_${i}`,
                timestamp: new Date(`${dateStr}T19:45:00`).getTime(),
                date: dateStr,
                time: '19:45',
                tod: 'Sera',
                sys: eSys,
                dia: eDia,
                pulse: eBpm,
                arm: 'Sinistro',
                position: 'Seduto',
                notes: i % 4 === 0 ? 'Dopo la passeggiata serale' : 'Dopo cena',
                tags: i % 2 === 0 ? ['Dopo farmaco'] : ['A riposo']
            });
        }

        this.readings = demoReadings.sort((a, b) => b.timestamp - a.timestamp);
        this.saveStorage();
    }

    // --- TOAST UTILITY ---
    showToast(msg) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Global App Instance Initialization
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new CardioPulseApp();
});
