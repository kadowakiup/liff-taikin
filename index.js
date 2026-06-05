const LIFF_ID = "2009827198-ryYvSe19"; 
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzle63bapXmwVkCuq1nJjhhe7NmLPWGhSwKpoXfwjN3Rp74ZiIbMXlFp9YthF9wSakI5A/exec";
// ※提示いただいたコードのままにしていますが、出勤用の登録LIFFとURLが異なる場合は適宜変更してください
const REGISTER_LIFF_URL = "https://liff.line.me/2009827198-ryYvSe19"; 

function updateStatus(text) {
  document.getElementById("status-text").innerHTML = text; // 改行を反映させるためinnerHTML
}

function showError(text, showRegisterBtn = false) {
  document.getElementById("spinner").style.display = "none";
  document.getElementById("status-text").innerText = "エラーが発生しました";
  document.getElementById("error-message").innerText = text;
  
  if (showRegisterBtn) {
    document.getElementById("register-container").style.display = "block";
  }
}

// ページの読み込みが完了したら自動でスタート
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

    // 自動でメイン処理を開始
    // ポップアップを出して「OK」が押された時だけメイン処理を開始
    if (window.confirm("本当に退勤しますか？")) {
      main();
    } else {
      // 「キャンセル」が押された場合はそのまま閉じる
      updateStatus("キャンセルしました");
      document.getElementById("spinner").style.display = "none";
      setTimeout(() => { liff.closeWindow(); }, 2000);
    }

  } catch (error) {
    showError("LIFFの読み込みに失敗しました。");
    console.error(error);
  }
};

async function main() {
  try {
    updateStatus("ユーザー情報を取得中...");
    const profile = await liff.getProfile();
    const userId = profile.userId;

    // ▼ 打刻済みかどうかの確認フロー
    updateStatus("打刻状態を確認中...");
    const checkPayload = {
      userId: userId,
      action: "check"
    };

    const checkResponse = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(checkPayload),
      redirect: "follow"
    });

    let checkResult;
    try {
      checkResult = await checkResponse.json();
    } catch (e) {
      throw new Error("確認処理で予期せぬエラーが発生しました。");
    }

    let saitinFlag = "no";

    // ★ 400（すでに退勤済み）だった場合
    // ▼▼▼ ステータスコードごとの条件分岐 ▼▼▼

    if (checkResult.status === 400) {
      // 400: すでに退勤済み
      document.getElementById("spinner").style.display = "none";
      updateStatus("すでに退勤しています。<br>出勤の場合は再度メニューから<br>出勤を押してください。");
      document.getElementById("status-text").style.color = "#ff334b";
      return; 
    } 
    // ▼▼▼ 新規追加：退勤時間前（405）のアラート ▼▼▼
    else if (checkResult.status === 405) {
      // 一旦ぐるぐるを消してアラートを出す
      document.getElementById("spinner").style.display = "none";
      
      // 確認ポップアップを表示
      // const isSure = window.confirm("予定の退勤時間より前ですが、本当に退勤してよろしいですか？");
      const isSure = window.confirm("予定の退勤時間より前なので本日稼働分が最賃になりますが、本当に退勤してよろしいですか？");
      
      if (!isSure) {
        // キャンセルされたら処理を完全にストップ
        updateStatus("キャンセルしました");
        setTimeout(() => { liff.closeWindow(); }, 1500);
        return;
      }
      
      // 「OK」が押されたら、再度ぐるぐるを出してこのまま下の「位置情報取得→本打刻」へ進ませる
      document.getElementById("spinner").style.display = "block";

      saitinFlag = "yes";
    }
    // ▲▲▲ ここまで追加 ▲▲▲
    else if (checkResult.status === 412) {
      // 412: シフトが休み扱い
      showError("シフトが休み扱いになっている可能性があります。社員に確認をしてください。");
      return;
    } 
    else if (checkResult.status === 416) {
      // 416: 出勤打刻なし
      showError("出勤打刻がされていません。社員に確認してください。");
      return;
    } 
    else if (checkResult.status === 444) {
      // 444: 前半・後半シフトの特殊エラー
      showError("前半のシフトに対する打刻でしたらすでに打刻されています。\n後半のシフトに対する打刻の場合、出勤打刻がされていないので社員に確認してください。");
      return;
    } 
    else if (checkResult.status !== 200) {
      throw new Error(`確認処理でエラーが発生しました。（コード: ${checkResult.status}）`);
    }

    // ▼ 200だった場合（本打刻に進む）
    updateStatus("位置情報を取得中...");
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
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

    const payload = {
      userId: userId,
      timestamp: timestamp,
      location: `${longitude},${latitude}`,
      action: "clock_out", // 退勤打刻のアクション名
      saitin: saitinFlag   // ▼▼▼ 3. ここを追加 ▼▼▼
    };

    updateStatus("データを送信中...");
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify(payload),
      redirect: "follow"
    });

    const responseText = await response.text();

    try {
      const resultJson = JSON.parse(responseText);
      if (resultJson.code !== 0 && resultJson.code !== undefined) {
        showError("名前の登録が見つかりませんでした。「登録」から名前の登録を行ってください。", true);
        return;
      }
    } catch (e) {
      if (!response.ok || responseText.includes("Error")) {
        throw new Error(`システムエラー: ${responseText}`);
      }
    }

    // 成功したらLIFFを閉じる
    document.getElementById("spinner").style.display = "none";
    updateStatus("退勤打刻完了！"); // メッセージを退勤用に変更
    setTimeout(() => {
      liff.closeWindow();
    }, 500);

  } catch (error) {
    console.error("Error:", error);
    
    // ▼ 位置情報（Geolocation）特有のエラーハンドリングを強化 ▼
    if (error.code === 1) {
      // 権限がない場合
      showError("位置情報の取得が許可されていません。スマホの設定からLINEへの位置情報アクセスを許可してください。");
    } else if (error.code === 3) {
      // タイムアウト（20秒見つからなかった）場合
      showError("位置情報の取得に時間がかかりすぎました。\n建物の奥にいるとGPSが届きません。窓際に移動するか、Wi-Fiをオンにしてから再度お試しください。");
    } else if (error.code === 2) {
      // 電波・ネットワーク不良で位置が特定できない場合
      showError("現在地を特定できませんでした。通信環境の良い場所で再度お試しください。");
    } else {
      // その他のシステムエラー
      showError(error.message || "予期せぬ通信エラーが発生しました。");
    }
  }
}