const LIFF_ID = "2009827198-EiWGvF0N"; 
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzEqLJDyl6t3N2pKcDnO0-w0uFTcO6x5tzQLN69-YsuSEWtEsMpXVwKx89592abTs7VdQ/exec";
// ★ 登録用LIFFのURLを定義
const REGISTER_LIFF_URL = "https://liff.line.me/2009827198-qvnHhjxl"; 

// 画面のテキストを更新する関数
function updateStatus(text) {
  document.getElementById("status-text").innerText = text;
}

// エラーを表示する関数（★ 登録ボタンを出すかどうかの判定を追加）
function showError(text, showRegisterBtn = false) {
  document.getElementById("spinner").style.display = "none";
  document.getElementById("status-text").innerText = "エラーが発生しました";
  // ボタンを出す場合は、メッセージを短く表示
  document.getElementById("error-message").innerText = text;
  
  if (showRegisterBtn) {
    document.getElementById("register-container").style.display = "block";
  }
}

// ページの読み込みが完了した時の処理
window.onload = async function() {
  try {
    await liff.init({ liffId: LIFF_ID });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    // 「出勤する」ボタンが押された時の処理
    document.getElementById("clock-in-btn").addEventListener("click", function() {
      if (navigator.geolocation) {
        document.getElementById("initial-view").style.display = "none";
        document.getElementById("spinner").style.display = "block";
        main(); 
      } else {
        showError("この端末では位置情報がサポートされていません。");
      }
    });

    // ★ 「登録画面へ進む」ボタンが押された時の処理
    document.getElementById("register-btn").addEventListener("click", function() {
      window.location.href = REGISTER_LIFF_URL; // 別LIFFへ遷移
    });

  } catch (error) {
    showError("LIFFの読み込みに失敗しました。");
    console.error(error);
  }
};

// メインの打刻処理
async function main() {
  try {
    updateStatus("ユーザー情報を取得中...");
    const profile = await liff.getProfile();
    const userId = profile.userId;

    updateStatus("位置情報を取得中...");
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
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
      action: "clock_in"
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

    // ★ GASから返ってきたテキスト（Anycrossの実行結果）を取得
    const responseText = await response.text();

    // ★ Anycrossのエラー判定処理
    try {
      const resultJson = JSON.parse(responseText);
      // Anycrossは成功時に code: 0 を返す仕様。0以外ならエラーとみなす。
      if (resultJson.code !== 0 && resultJson.code !== undefined) {
        // メッセージをシンプルに変更
        showError("名前の登録が見つかりませんでした。「登録」から名前の登録を行ってください。", true);
        return;
        }
    } catch (e) {
      // JSON形式じゃないエラー（GASがクラッシュした等）の場合は通常の通信エラー扱い
      if (!response.ok || responseText.includes("Error")) {
        throw new Error(`システムエラー: ${responseText}`);
      }
    }

    // 成功したらLIFFを閉じる
    document.getElementById("spinner").style.display = "none";
    updateStatus("打刻完了！");
    setTimeout(() => {
      liff.closeWindow();
    }, 500);

  } catch (error) {
    console.error("Error:", error);
    
    if (error.code === 1) {
      showError("位置情報の取得が許可されていません。スマホの設定からLINEへの位置情報アクセスを許可してください。");
    } else {
      showError(error.message || "予期せぬ通信エラーが発生しました。");
    }
  }
}