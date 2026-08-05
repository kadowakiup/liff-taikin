const LIFF_ID = "2009827198-ryYvSe19"; 
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzle63bapXmwVkCuq1nJjhhe7NmLPWGhSwKpoXfwjN3Rp74ZiIbMXlFp9YthF9wSakI5A/exec";
const REGISTER_LIFF_URL = "https://liff.line.me/2009827198-ryYvSe19"; 

function updateStatus(text) {
  document.getElementById("status-text").innerHTML = text; 
}

function showError(text, showRegisterBtn = false) {
  document.getElementById("spinner").style.display = "none";
  document.getElementById("status-text").innerText = "エラーが発生しました";
  document.getElementById("error-message").innerText = text;
  
  if (showRegisterBtn) {
    document.getElementById("register-container").style.display = "block";
  }
}

// ==========================================
// ★自動リトライ機能（不死鳥モード）
// ==========================================
async function fetchWithRetry(url, params, maxRetries, statusTextPrefix) {
  for (let i = 0; i < maxRetries; i++) {
    params.set('t', Date.now()); // キャッシュクリア
    const fetchUrl = `${url}?${params.toString()}`;
    
    if (i > 0) {
      updateStatus(`${statusTextPrefix}<br><span style="font-size:0.85em; color:#ff9900;">(混雑を検知... 再接続中 ${i+1}/${maxRetries})</span>`);
    } else {
      updateStatus(`${statusTextPrefix}<br>このままお待ちください`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); 

    try {
      const response = await fetch(fetchUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const responseText = await response.text();
      
      if (responseText.includes("現在、ファイルを開くことができません") || responseText.includes("<html")) {
        throw new Error("GoogleHTML_Error");
      }

      const resultJson = JSON.parse(responseText);
      return resultJson; 

    } catch (error) {
      clearTimeout(timeoutId);
      console.warn(`通信アタック ${i + 1}回目 失敗:`, error);
      
      if (i === maxRetries - 1) {
        if (error.name === 'AbortError') {
          throw new Error("アクセスが集中し、通信がタイムアウトしました。");
        } else if (error.message === "GoogleHTML_Error" || error instanceof SyntaxError) {
          throw new Error("システムが大変混み合っています。");
        } else {
          throw new Error("予期せぬ通信エラーが発生しました。");
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}

window.onload = async function() {
  try {
    await liff.init({ liffId: LIFF_ID });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    document.getElementById("register-btn").addEventListener("click", function() {
      window.location.href = REGISTER_LIFF_URL;
    });

    if (window.confirm("本当に退勤しますか？")) {
      main();
    } else {
      updateStatus("キャンセルしました");
      document.getElementById("spinner").style.display = "none";
      setTimeout(() => { liff.closeWindow(); }, 2000);
    }

  } catch (error) {
    showError("LIFFの読み込みに失敗しました。\n詳細: " + (error.message || error));
    console.error(error);
  }
};

async function main() {
  try {
    updateStatus("ユーザー情報を取得中...");
    const profile = await liff.getProfile();
    const userId = profile.userId;

    // ==========================================
    // 1. 打刻状態の確認処理 (リトライ機能付き)
    // ==========================================
    const checkParams = new URLSearchParams({
      userId: userId,
      action: "check"
    });

    let checkResult;
    try {
      checkResult = await fetchWithRetry(WEBHOOK_URL, checkParams, 4, "打刻状態を確認中...");
    } catch (e) {
      throw new Error(`${e.message}\n少し時間をおいてから再度お試しいただくか、Lark上で直接確認してください。`);
    }

    // AnycrossがBodyの中にステータスを隠している場合を取り出す
    let currentStatus = checkResult.status;
    if (currentStatus === 200 && checkResult.body) {
      try {
        const bodyJson = JSON.parse(checkResult.body);
        if (bodyJson.status) {
          currentStatus = bodyJson.status;
        }
      } catch (err) {}
    }

    let saitinFlag = "no";

    // ▼▼▼ ステータスコードごとの条件分岐 ▼▼▼
    if (currentStatus === 400) {
      document.getElementById("spinner").style.display = "none";
      updateStatus("すでに退勤しています。<br>出勤の場合は再度メニューから<br>出勤を押してください。");
      document.getElementById("status-text").style.color = "#ff334b";
      return; 
    } 
    else if (currentStatus === 405) {
      document.getElementById("spinner").style.display = "none";
      const isSure = window.confirm("予定の退勤時間より前なので本日稼働分が最賃になりますが、本当に退勤してよろしいですか？");
      
      if (!isSure) {
        updateStatus("キャンセルしました");
        setTimeout(() => { liff.closeWindow(); }, 1500);
        return;
      }
      
      document.getElementById("spinner").style.display = "block";
      saitinFlag = "yes";
    }
    else if (currentStatus === 412) {
      showError("シフトが休み扱いになっている可能性があります。社員に確認をしてください。");
      return;
    } 
    else if (currentStatus === 416) {
      showError("出勤打刻がされていません。社員に確認してください。");
      return;
    } 
    else if (currentStatus === 444) {
      showError("前半のシフトに対する打刻でしたらすでに打刻されています。\n後半のシフトに対する打刻の場合、出勤打刻がされていないので社員に確認してください。");
      return;
    } 
    else if (currentStatus !== 200) {
      throw new Error(`確認処理エラー（コード: ${currentStatus}）\n詳細: ${checkResult.body || ""}`);
    }

    // ==========================================
    // 2. 位置情報の取得
    // ==========================================
    updateStatus("位置情報を取得中...<br>お待ちください");
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, 
        timeout: 30000,            
        maximumAge: 60000          
      });
    });

    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}`;

    // ==========================================
    // 3. 本打刻データの送信 (リトライ機能付き)
    // ==========================================
    const submitParams = new URLSearchParams({
      userId: userId,
      timestamp: timestamp,
      location: `${longitude},${latitude}`,
      action: "clock_out",
      saitin: saitinFlag
    });

    let resultJson;
    try {
      resultJson = await fetchWithRetry(WEBHOOK_URL, submitParams, 4, "データを送信中...");
    } catch (e) {
      throw new Error(`${e.message}\n電波の良い環境で再度お試しいただくか、打刻できているか社員に確認してください。`);
    }

    // ★ 変更点：出勤打刻に合わせて status: 200 で成功判定するように統一
    if (resultJson.status !== 200 && resultJson.status !== undefined) {
      showError("処理エラーが発生しました。（ステータス: " + resultJson.status + "）", true);
      return;
    }

    // 打刻完了時の処理
    document.getElementById("spinner").style.display = "none";
    updateStatus("退勤打刻完了！<br>画面左上の「×」ボタンで閉じてください。");

  } catch (error) {
    console.error("Error:", error);
    
    if (error.code === 1) {
      showError("位置情報の取得が許可されていません。スマホの設定からLINEへの位置情報アクセスを許可してください。");
    } else if (error.code === 3) {
      showError("位置情報の取得に時間がかかりすぎました。\n建物の奥にいるとGPSが届きません。窓際に移動するか、Wi-Fiをオンにしてから再度お試しください。");
    } else if (error.code === 2) {
      showError("現在地を特定できませんでした。通信環境の良い場所で再度お試しください。");
    } else {
      showError(error.message || "予期せぬ通信エラーが発生しました。");
    }
  }
}