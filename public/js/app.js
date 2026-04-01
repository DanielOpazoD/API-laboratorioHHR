/**
 * App Logic para Syslab 2.0 con Vista por Secciones
 */

let allExams = [];
let selectedExams = [];

async function searchExams() {
    const rutInput = document.getElementById('rutInput');
    const rut = rutInput.value.trim();
    if (!rut) { return showError('Por favor, ingresa un RUT válido.'); }
    setLoading(true);
    hideResults();

    try {
        const response = await fetch(`/api/exams?rut=${rut}`);
        const data = await response.json();
        if (data.success) {
            allExams = data.data;
            renderExamsTable(allExams);
            showResults();
        } else {
            showError(data.error || 'No se pudieron obtener los resultados.');
        }
    } catch (err) {
        showError('Error de conexión con el servidor: ' + err.message);
    } finally {
        setLoading(false);
    }
}

function renderExamsTable(exams) {
    const tbody = document.getElementById('examsBody');
    tbody.innerHTML = '';
    selectedExams = [];
    updateActionsBar();
    if (exams.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem;">No se encontraron resultados.</td></tr>';
        return;
    }
    exams.forEach((exam, index) => {
        const tr = document.createElement('tr');
        const badges = exam.exams.map(name => `<span class="exam-badge">${name}</span>`).join('');
        tr.innerHTML = `
            <td class="checkbox-cell">
                <input type="checkbox" onchange="toggleSelect(${index}, this.checked)">
            </td>
            <td>
                <div style="font-weight: 600;">${exam.date}</div>
                <div style="font-size: 0.8rem; color: #6b7280;">${exam.time}</div>
            </td>
            <td>${exam.id}</td>
            <td>${badges}</td>
            <td>
                ${exam.link ? `<a href="${exam.link}" target="_blank" class="pdf-link"><span>📄</span> Abrir</a>` : '-'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleSelect(index, isChecked) {
    if (isChecked) { selectedExams.push(allExams[index]); } 
    else { selectedExams = selectedExams.filter(e => e.id !== allExams[index].id); }
    updateActionsBar();
}

function updateActionsBar() {
    const bar = document.getElementById('actionsBar');
    const count = document.getElementById('selectedCount');
    if (selectedExams.length > 0) {
        bar.style.display = 'flex';
        count.innerText = `${selectedExams.length} examen(es) seleccionado(s)`;
    } else { bar.style.display = 'none'; }
}

async function generateSummary() {
    const summaryContainer = document.getElementById('summaryContainer');
    const summaryBody = document.getElementById('summaryBody');
    const btn = document.querySelector('.summary-btn');
    
    btn.disabled = true;
    btn.innerText = '⌛ Analizando caracteres (OCR/Parsing)...';
    setLoading(true);
    summaryBody.innerHTML = '';
    
    try {
        const links = selectedExams.map(e => e.link).filter(l => !!l);
        const response = await fetch('/api/exams/details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ links })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error);

        // Renderizar por SECCIONES
        let html = `
            <div style="margin-bottom: 2rem; padding: 1.5rem; background: #f8fafc; border-radius: 16px; border: 2px solid var(--primary-light);">
                <p><strong>Paciente:</strong> ${selectedExams[0].patientName}</p>
                <p><strong>Fecha Generación:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Formato:</strong> Extracción Estructural Inteligente</p>
            </div>
        `;

        data.data.forEach((examDetail) => {
            const originalInfo = selectedExams.find(e => e.link === examDetail.url);
            
            html += `
                <div style="margin-top: 2rem; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                        <h3 style="color: var(--primary);">Atención: ${originalInfo ? originalInfo.date : 'Fecha desconocida'}</h3>
                        <span style="background: #eff6ff; color: #1e40af; padding: 0.3rem 0.8rem; border-radius: 8px; font-weight: 600; font-size: 0.8rem;">ID: ${originalInfo ? originalInfo.id : '?'}</span>
                    </div>
            `;

            if (examDetail.findings.length === 0) {
                html += `<p style="color: #94a3b8; text-align: center;">No se pudieron detectar resultados numéricos estructurados.</p>`;
            } else {
                // Agrupar por secciones
                const sections = {};
                examDetail.findings.forEach(f => {
                    if (!sections[f.section]) sections[f.section] = [];
                    sections[f.section].push(f);
                });

                Object.keys(sections).forEach(sec => {
                    html += `
                        <div style="margin-top: 1.5rem;">
                            <h5 style="background: #f1f5f9; padding: 0.5rem 1rem; border-radius: 6px; margin-bottom: 0.5rem; color: #475569; letter-spacing: 0.05em;">${sec}</h5>
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="text-align: left; font-size: 0.75rem; color: #94a3b8;">
                                        <th style="padding: 0.5rem;">VARIABLE</th>
                                        <th style="padding: 0.5rem;">VALOR</th>
                                        <th style="padding: 0.5rem;">UNIDAD</th>
                                        <th style="padding: 0.5rem;">REF.</th>
                                    </tr>
                                </thead>
                                <tbody>
                    `;

                    sections[sec].forEach(row => {
                        html += `
                            <tr style="border-bottom: 1px solid #f8fafc;">
                                <td style="padding: 0.5rem; font-weight: 500;">${row.analysis}</td>
                                <td style="padding: 0.5rem; font-weight: 800; color: #111827;">${row.result}</td>
                                <td style="padding: 0.5rem; color: #64748b; font-size: 0.85rem;">${row.unit}</td>
                                <td style="padding: 0.5rem; color: #94a3b8; font-size: 0.8rem;">${row.refValue}</td>
                            </tr>
                        `;
                    });

                    html += `</tbody></table></div>`;
                });
            }
            html += `</div>`;
        });

        summaryBody.innerHTML = html;
        summaryContainer.style.display = 'block';
        summaryContainer.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        showError('Falla en la lectura inteligente: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = '📋 Generar Resumen Seleccionados';
        setLoading(false);
    }
}

function closeSummary() { document.getElementById('summaryContainer').style.display = 'none'; }
function setLoading(loading) {
    document.getElementById('loader').style.display = loading ? 'flex' : 'none';
    document.getElementById('searchBtn').disabled = loading;
}
function showError(msg) { alert(msg); }
function showResults() { document.getElementById('resultsSection').style.display = 'block'; }
function hideResults() {
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('summaryContainer').style.display = 'none';
}
document.getElementById('rutInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') searchExams(); });
