const risingList = document.getElementById("risingList");
const cautionList = document.getElementById("cautionList");
const lastRunEl = document.getElementById("lastRun");
const refreshBtn = document.getElementById("refreshBtn");
const detailPanel = document.getElementById("detailPanel");

function fmtDate(iso) {
  if (!iso) return "لسا ما تحدّث";
  const d = new Date(iso);
  return "آخر تحديث: " + d.toLocaleString("ar-SA");
}

function sentimentBadgeClass(sentiment) {
  if (sentiment === "Positive") return "up";
  if (sentiment === "Negative") return "down";
  if (sentiment === "Mixed") return "accent";
  return "neutral";
}

function stockCard(stock) {
  const scoreClass = stock.composite >= 0 ? "up" : "down";
  const topReason = (stock.aiFactors && stock.aiFactors[0]) || null;
  const ml = stock.mlPrediction;
  const mlBadge = ml
    ? `<span class="badge ${ml.direction === "up" ? "up" : ml.direction === "down" ? "down" : "neutral"}">ML ${ml.direction === "up" ? "↑" : ml.direction === "down" ? "↓" : "–"} ${ml.confidence}%${
        ml.sampleSize > 0 ? ` · دقة ${(ml.rollingAccuracy * 100).toFixed(0)}%` : " · جديد"
      }</span>`
    : "";
  return `
    <div class="stock-card" data-ticker="${stock.ticker}">
      <div class="stock-card-top">
        <div><span class="stock-ticker">${stock.ticker}</span><span class="stock-name">${stock.name}</span></div>
        <span class="stock-score ${scoreClass}">${stock.composite > 0 ? "+" : ""}${stock.composite}</span>
      </div>
      <div class="stock-summary">${stock.aiSummary || "—"}</div>
      ${topReason ? `<div class="why-line"><span class="why-label">ليه؟</span> ${topReason.note}</div>` : ""}
      <div class="badges">
        <span class="badge ${sentimentBadgeClass(stock.newsSentiment)}">${stock.newsSentiment} news</span>
        <span class="badge neutral">RSI ${stock.rsi.toFixed(0)}</span>
        <span class="badge ${stock.trendSignal === "golden" ? "up" : stock.trendSignal === "death" ? "down" : "neutral"}">${stock.trendSignal}</span>
        ${mlBadge}
      </div>
    </div>`;
}

function renderList(el, stocks, emptyMsg) {
  if (!stocks.length) {
    el.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
    return;
  }
  el.innerHTML = stocks.map(stockCard).join("");
  el.querySelectorAll(".stock-card").forEach((card) => {
    card.addEventListener("click", () => showDetail(card.dataset.ticker));
  });
}

async function loadDashboard() {
  const res = await fetch("/api/dashboard");
  const data = await res.json();
  lastRunEl.textContent = fmtDate(data.lastRun);
  renderList(risingList, data.rising, "ما فيه إشارات صعود واضحة اليوم. جرّب زر «تحديث الآن».");
  renderList(cautionList, data.caution, "ما فيه إشارات تحذير اليوم.");
}

async function showDetail(ticker) {
  const res = await fetch(`/api/stocks/${ticker}`);
  if (!res.ok) return;
  const s = await res.json();

  detailPanel.classList.remove("hidden");
  detailPanel.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-title">${s.ticker}</div>
        <div class="muted">${s.name} · ${s.sector}</div>
      </div>
      <div>
        <div class="detail-price">$${s.last.toFixed(2)}</div>
        <div class="mono ${s.change >= 0 ? "stock-score up" : "stock-score down"}" style="font-size:13px;text-align:end;">
          ${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)} (${s.changePct.toFixed(2)}%)
        </div>
        ${s.lastNewsCheck ? `<div class="muted" style="text-align:end;margin-top:4px;">آخر فحص أخبار: ${new Date(s.lastNewsCheck).toLocaleString("ar-SA")}</div>` : ""}
      </div>
    </div>

    <p style="font-size:13.5px;color:var(--text);line-height:1.6;">${s.aiSummary || ""}</p>

    <div class="section-label">النموذج الإحصائي (تعلّم تراكمي)</div>
    <div class="factor-item">
      <div class="factor-note">
        ${
          s.mlPrediction
            ? `توقّع الاتجاه القادم: <b>${s.mlPrediction.direction === "up" ? "صعود ↑" : s.mlPrediction.direction === "down" ? "هبوط ↓" : "غير محدد"}</b>
               بثقة ${s.mlPrediction.confidence}/100.
               ${
                 s.mlPrediction.sampleSize > 0
                   ? `دقة النموذج التاريخية على آخر ${s.mlPrediction.sampleSize} توقّع: <b>${(s.mlPrediction.rollingAccuracy * 100).toFixed(0)}%</b>.`
                   : "ما فيه سجل توقعات كافي بعد لقياس الدقة — يبدأ يتراكم من أول تحديث."
               }
               <br/><span class="muted">ملاحظة: توقّع اتجاه سهم بيوم واحد صعب إحصائيًا حتى لنماذج متقدمة — 50% تقريبًا يعادل رمي عملة. خذ هذا الرقم كمؤشر إضافي مو كضمان.</span>`
            : "لا يوجد توقع بعد."
        }
      </div>
    </div>

    <div class="section-label">عوامل التحليل</div>
    <div class="factor-list">
      ${(s.aiFactors || [])
        .map((f) => `<div class="factor-item"><div class="factor-label">${f.label}</div><div class="factor-note">${f.note}</div></div>`)
        .join("") || '<div class="empty-state">لا يوجد تحليل بعد.</div>'}
    </div>

    <div class="section-label">آخر الأخبار</div>
    ${
      (s.headlines || [])
        .map(
          (h) =>
            `<div class="headline-item"><div class="headline-title">${h.title}</div><div class="headline-source">${h.source}</div><div class="headline-note">${h.note}</div></div>`
        )
        .join("") || '<div class="empty-state">لا توجد أخبار حديثة.</div>'
    }

    <div style="margin-top:16px;">
      <button class="close-btn" id="closeDetail">إغلاق</button>
    </div>
  `;
  document.getElementById("closeDetail").addEventListener("click", () => detailPanel.classList.add("hidden"));
  detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

refreshBtn.addEventListener("click", async () => {
  const token = prompt("أدخل رمز المشرف (ADMIN_TOKEN) لتشغيل التحديث اليدوي:");
  if (!token) return;
  refreshBtn.disabled = true;
  refreshBtn.textContent = "جاري التحديث… قد يستغرق دقيقة";
  try {
    const res = await fetch("/api/refresh", { method: "POST", headers: { "x-admin-token": token } });
    if (!res.ok) throw new Error((await res.json()).error || "فشل التحديث");
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "تحديث الآن";
  }
});

loadDashboard();
