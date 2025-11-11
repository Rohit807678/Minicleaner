// SPA navigation
const pages = ["home","cleaner","about","tech","contact","faq"];
function showPage(page){
  pages.forEach(pid => document.getElementById("page-"+pid).classList.remove("active"));
  document.getElementById("page-"+page).classList.add("active");
}
document.querySelectorAll("[data-page]").forEach(link=>{
  link.addEventListener("click", e => { e.preventDefault(); showPage(link.getAttribute("data-page")); toggleSidebar(false); });
});
document.getElementById("goCleanerBtn").onclick = ()=> showPage("cleaner");

// Sidebar
const sidebar = document.getElementById("sidebar");
document.getElementById("menuBtn").onclick = ()=> sidebar.classList.add("active");
document.getElementById("closeSidebar").onclick = ()=> sidebar.classList.remove("active");
function toggleSidebar(v){ if(!v) sidebar.classList.remove("active"); }

// State
let availableColumns = [];
let currentState = { columns: [], rowCount: 0 };
let filename = "";

// Elements
const el = (id)=>document.getElementById(id);
const uploadFile = el("uploadFile");
const uploadBtn = el("uploadBtn");
const uploadStatus = el("uploadStatus");
const uploadCard = el("uploadCard");
const previewCard = el("previewCard");
const filenameSmall = el("filenameSmall");
const rowCountLabel = el("rowCount");
const downloadBtn = el("downloadBtn");
const startOverBtn = el("startOverBtn");

// Upload
uploadBtn.onclick = async function(){
  const file = uploadFile.files[0];
  if(!file){ uploadStatus.textContent = "Please select a file."; return; }
  uploadStatus.textContent = "Processing...";
  el("filename").textContent = file.name;

  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await axios.post("http://localhost:3000/api/upload", formData, { headers:{ "Content-Type":"multipart/form-data" }});
    filename = file.name;
    availableColumns = res.data.columns || [];
    currentState = { columns: [...availableColumns], rowCount: res.data.rowCount || 0 };

    // Build controls
    renderCleaner(res.data.preview || [], availableColumns, res.data.rowCount || 0);

    uploadCard.style.display = "none";
    previewCard.style.display = "";
    filenameSmall.textContent = filename + " ";
    rowCountLabel.textContent = `${currentState.rowCount} rows`;
    uploadStatus.textContent = "Uploaded successfully.";
  } catch(e){
    uploadStatus.textContent = "Upload failed: " + (e?.response?.data?.error || e.message);
  }
};

// Start over
startOverBtn.onclick = ()=>{
  uploadCard.style.display = "";
  previewCard.style.display = "none";
  uploadStatus.textContent = "";
  uploadFile.value = "";
  el("filename").textContent = "";
  el("cleanedPreview").innerHTML = "";
  filename = "";
  availableColumns = [];
  currentState = { columns: [], rowCount: 0 };
};

// Download
downloadBtn.onclick = ()=> { window.location.href = "http://localhost:3000/api/download"; };

// Build cleaner controls and preview
function renderCleaner(previewRows, columns, rowCount){
  renderPreview(previewRows, columns);

  // Columns multi-check (select subset)
  const columnsContainer = el("columnsContainer");
  columnsContainer.innerHTML = "";
  columns.forEach(c=>{
    const id = "col__" + c.replace(/\W+/g,"_");
    const w = document.createElement("label");
    w.innerHTML = `<input type="checkbox" id="${id}" checked> ${c}`;
    w.querySelector("input").addEventListener("change", ()=>{
      currentState.columns = columns.filter(col=>{
        const cid = "col__" + col.replace(/\W+/g,"_");
        return el(cid).checked;
      });
    });
    columnsContainer.appendChild(w);
  });
  currentState.columns = [...columns];

  // Duplicate check columns
  const dupColsContainer = el("dupColsContainer");
  dupColsContainer.innerHTML = "";
  columns.forEach(c=>{
    const id = "dup__" + c.replace(/\W+/g,"_");
    const w = document.createElement("label");
    w.innerHTML = `<input type="checkbox" id="${id}"> ${c}`;
    dupColsContainer.appendChild(w);
  });

  // Replace column select
  const replaceCol = el("replaceCol");
  replaceCol.innerHTML = `<option>All Columns</option>` + columns.map(c=>`<option>${c}</option>`).join("");

  // To number checkboxes
  const toNumberContainer = el("toNumberContainer");
  toNumberContainer.innerHTML = "";
  columns.forEach(c=>{
    const id = "num__" + c.replace(/\W+/g,"_");
    const w = document.createElement("label");
    w.innerHTML = `<input type="checkbox" id="${id}"> ${c}`;
    toNumberContainer.appendChild(w);
  });

  // Replace button
  el("replaceBtn").onclick = async ()=>{
    await applyCleaning({ replaceOnly:true });
  };

  // Apply cleaning
  el("applyCleanBtn").onclick = async ()=>{
    await applyCleaning({});
  };
}

// Render table
function renderPreview(rows, columns){
  if(!rows || !rows.length || !columns || !columns.length){
    el("cleanedPreview").innerHTML = "<p class='muted'>No preview available.</p>";
    return;
  }
  let html = "<table><thead><tr>";
  columns.forEach(c=> html += `<th>${escapeHtml(c)}</th>`);
  html += "</tr></thead><tbody>";
  rows.slice(0,20).forEach(r=>{
    html += "<tr>";
    columns.forEach(c=> html += `<td>${escapeHtml(r[c])}</td>`);
    html += "</tr>";
  });
  html += "</tbody></table>";
  el("cleanedPreview").innerHTML = html;
}

function escapeHtml(v){
  if(v === null || v === undefined) return "";
  return String(v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));
}

// Collect form state and call /api/clean
async function applyCleaning({ replaceOnly=false }){
  const columns = currentState.columns && currentState.columns.length ? currentState.columns : availableColumns;

  // Fill missing
  let fillMissing = "none";
  const fm = document.querySelector("input[name='fillMissing']:checked");
  if(fm) fillMissing = fm.value;

  // Duplicates
  const removeDuplicates = el("removeDuplicates").checked;
  const duplicateCheckColumns = availableColumns.filter(c => {
    const id = "dup__" + c.replace(/\W+/g,"_");
    const box = el(id);
    return box && box.checked;
  });

  // Replace
  const replaceCol = el("replaceCol").value;
  const replaceFrom = el("replaceFrom").value ?? "";
  const replaceTo = el("replaceTo").value ?? "";

  // To number
  const toNumber = availableColumns.filter(c => {
    const id = "num__" + c.replace(/\W+/g,"_");
    const box = el(id);
    return box && box.checked;
  });

  const payload = {
    columns,
    removeDuplicates,
    fillMissing: fillMissing === "none" ? null : fillMissing,
    toNumber,
    replaceCol,
    replaceFrom,
    replaceTo,
    duplicateCheckColumns
  };

  try{
    const res = await axios.post("http://localhost:3000/api/clean", payload);
    const { preview, columns: cols, rowCount } = res.data || {};
    if(cols && cols.length){ currentState.columns = cols; }
    if(typeof rowCount === "number"){ currentState.rowCount = rowCount; }
    renderPreview(preview || [], cols || columns);
    rowCountLabel.textContent = `${currentState.rowCount} rows`;
  }catch(e){
    alert("Cleaning error: " + (e?.response?.data?.error || e.message));
  }
}
