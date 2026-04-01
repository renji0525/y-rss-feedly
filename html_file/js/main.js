/**
 * アプリケーションの全体状態（ステート）
 * チャンネル、動画リスト、設定をまとめて管理し、LocalStorageに保存する対象となります。
 */
let appState = {
    channels: [],       // 登録されたチャンネル情報 {id, title}
    videos: [],         // 取得した動画の全リスト
    darkMode: true,     // ダークモードの設定状態
    selectedChannel: 'all' // 現在表示しているフィルタ（'all' または チャンネルID）
};

/**
 * 通知表示機能（スタック対応）
 * 画面右下にメッセージを表示します。連続して呼ばれた場合は上に積み重なります。
 * @param {string} message - 表示する文字列
 * @param {string} type - 'success'(緑), 'error'(赤), 'info'(青)
 * @param {number} waitTime - 自動で消えるまでの時間(ms)
 */
function showNotification(message, type=`info`, waitTime=3000) {
    const notify = document.createElement('div');
    notify.className = 'notification-toast'; // スタイリングと重なり判定用のクラス

    // --- スタック計算ロジック ---
    // 既存の通知を数えて、新しい通知の「底(bottom)」の位置をずらす
    const existingNotifications = document.querySelectorAll('.notification-toast');
    const offsetGap = 60; // 1つあたりの高さ＋余白
    const bottomPosition = 20 + (existingNotifications.length * offsetGap);

    const colors = {
        success: '#4caf50', // 緑
        error:   '#f04b4b', // 赤
        info:    `#2196f3`  // 青
    };
    const bgColor = colors[type] || colors.error;

    // スタイルを動的に適用
    notify.style.cssText = `
        position:fixed;
        bottom:${bottomPosition}px;
        right:20px;
        background:${bgColor};
        color:white;
        padding:12px 24px;
        border-radius:8px;
        box-shadow:0 4px 12px rgba(0,0,0,0.3);
        z-index:9999;
        font-size:14px;
        animation:slideIn 0.3s ease-out;
        transition: bottom 0.3s ease;
    `;
    notify.textContent = message;
    document.body.appendChild(notify);

    // 一定時間後にアニメーションさせてから要素を削除する
    setTimeout(() => {
        notify.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => {
            notify.remove();
            repositionNotifications(); // 消えた後に残った通知を下に詰める
        }, 300);
    }, waitTime);
}

/**
 * 通知が消えた後に、画面に残っている通知を下に詰める処理
 */
function repositionNotifications() {
    const notifications = document.querySelectorAll('.notification-toast');
    const offsetGap = 60;
    notifications.forEach((el, index) => {
        el.style.bottom = `${20 + (index * offsetGap)}px`;
    });
}

/**
 * データの永続化（保存）
 * 現在の appState を JSON文字列にして LocalStorage に書き込みます。
 */
function save() { localStorage.setItem('yt_v5_final', JSON.stringify(appState)); }

/**
 * データの復元（読み込み）
 * ブラウザに保存されているデータを読み込み、UIを初期化します。
 */
function load() {
    const data = localStorage.getItem('yt_v5_final');
    if (data) {
        appState = JSON.parse(data);
        // 保存されていたモードを適用
        document.body.setAttribute('data-theme', appState.darkMode ? 'dark' : 'light');
        renderChannels(); // サイドバー再描画
        renderVideos();   // メインエリア再描画
    }
}

/**
 * 非同期の待機処理
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * GAS（Google Apps Script）経由でYouTubeのフィードを取得する
 * @param {string} channelId - YouTubeのチャンネルID
 * @param {string} inChannelName - ログ表示用のチャンネル名
 * @param {string} addText - 進行状況などの追加テキスト
 */
async function fetchFeed(channelId, inChannelName="None", addText="") {
    // 簡易認証キーの取得
    const myApikey = document.getElementById('apiKeyInput').value.trim();

    // 認証キーが無い場合はエラー文を表示して終了
    if(`${myApikey}` === '') {
        showNotification(`エラー apikeyが未入力です。`,"error");
        return null;
    }

    await sleep(500); // サーバー負荷軽減のための短い待機
    if(addText !== '') showNotification(addText);

    // APIのパラメータ構築
    const params = new URLSearchParams({
        channel_id: channelId,
        key: myApikey // 簡易的な認証キー
    });
    const baseUrl = `https://script.google.com/macros/s/AKfycbyXRNKLdzWdJAc5iJEfp1hAEbScOERyGboIJZD8hZFprfPo7g57Ip3BjddtiHRdWwyB/exec`;
    const apiUrl = `${baseUrl}?${params.toString()}`;

    try {
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        const data = await res.json();
        
        if (data.status === 'ok') {
            showNotification(`成功 [${inChannelName}]`, "success");
            // 取得したデータをアプリ内の共通フォーマットに変換
            return {
                name: data.feed.title,
                items: data.items.map(item => ({
                    id: item.link.split('v=')[1], // URLから動画IDを抽出
                    channelId: channelId,
                    channelName: data.feed.title,
                    title: item.title,
                    thumb: item.thumbnail,
                    url: item.link,
                    published: item.pubDate,
                    watched: false // デフォルトは未読
                }))
            };
        } else {
            throw new Error(data.message || "取得失敗");
        }
    } catch (e) {
        showNotification(`エラー [${channelId}]: ${e.message}`, "error");
        return null;
    }
}

/**
 * 新しいチャンネルをリストに追加する
 */
async function addNewChannel() {
    let input = document.getElementById('channelIdInput').value.trim();
    // 入力がURLの場合でもID部分(UC...)だけを抜き出す正規表現
    const idMatch = input.match(/(UC[a-zA-Z0-9_-]{22})/);
    const cid = idMatch ? idMatch[1] : input;

    // 空チェックおよび重複チェック
    if (!cid || appState.channels.some(c => c.id === cid)) return;

    const result = await fetchFeed(cid);
    // 取得失敗しても、とりあえずIDだけは登録する（あとでリトライ可能にするため）
    const channelName = result ? result.name : `Channel(${cid.substring(0,6)})`;

    appState.channels.push({ id: cid, title: channelName });
    document.getElementById('channelIdInput').value = ''; // 入力欄をクリア
    
    if (result) mergeVideos(result.items); // 動画リストを合流
    save();
    renderChannels();
}

/**
 * チャンネルの削除
 */
function removeChannel(cid, event) {
    event.stopPropagation(); // 親要素のクリックイベント（フィルタ切り替え）を阻止
    if (!confirm("チャンネルと動画データを削除しますか？")) return;
    
    // チャンネルリストと動画リストの両方から削除
    appState.channels = appState.channels.filter(c => c.id !== cid);
    appState.videos = appState.videos.filter(v => v.channelId !== cid);
    
    // 削除したチャンネルを表示中だった場合は「すべて」に戻す
    if (appState.selectedChannel === cid) appState.selectedChannel = 'all';
    
    save();
    renderChannels();
    renderVideos();
}

/**
 * 全チャンネル（または選択中チャンネル）の最新動画を再取得する
 */
async function refreshAll() {
    showNotification(`RRS 更新開始`);
    const selectTarget = `${appState.selectedChannel}`;
    const channelCountMax = appState.channels.length;
    let count = 1;

    for (const ch of appState.channels) {
        let addText = "";
        // 特定のチャンネルが選択されている場合は、それ以外をスキップ
        if(`${selectTarget}` !== 'all') {
            if(`${selectTarget}` !== `${ch.id}`) { continue; }
        } else {
            // 全体更新の場合は進捗を出す
            addText = `${count} / ${channelCountMax} 件目 処理開始`
            count++;
        }
        
        const result = await fetchFeed(ch.id, ch.title, addText);
        if (result) {
            // 仮の名前(Channel(UC...))で登録されていた場合は正式名称に更新
            if (ch.title.startsWith('Channel(')) ch.title = result.name;
            mergeVideos(result.items);
        }
    }
    
    // 公開日の降順（新しい順）に並べ替え
    appState.videos.sort((a, b) => new Date(b.published) - new Date(a.published));
    
    save();
    renderChannels();
    renderVideos();
    showNotification(`RSS 更新終了`);
}

/**
 * 重複を避けて動画リストを統合する
 */
function mergeVideos(newVideos) {
    newVideos.forEach(nv => {
        // すでに存在するID（動画）は追加しない
        if (!appState.videos.some(v => v.id === nv.id)) appState.videos.push(nv);
    });
}

/**
 * サイドバーのチャンネルリストを描画する
 */
function renderChannels() {
    const list = document.getElementById('channel-list');
    list.innerHTML = `
        <div class="channel-item-container all-view ${appState.selectedChannel === 'all' ? 'active' : ''}">
            <div class="channel-link" onclick="filterChan('all')">すべて表示</div>
        </div>`;
        
    appState.channels.forEach(ch => {
        const item = document.createElement('div');
        item.className = `channel-item-container ${appState.selectedChannel === ch.id ? 'active' : ''}`;
        item.innerHTML = `
            <div class="channel-link" onclick="filterChan('${ch.id}')">${ch.title}</div>
            <div class="btn-delete-ch" title="削除" onclick="removeChannel('${ch.id}', event)">✕</div>
        `;
        list.appendChild(item);
    });
}

/**
 * メインエリアの動画カードリストを描画する
 */
function renderVideos() {
    const container = document.getElementById('video-container');
    container.innerHTML = '';
    
    // 現在選択されているチャンネルに応じてフィルタリング
    const displayList = appState.selectedChannel === 'all' 
        ? appState.videos 
        : appState.videos.filter(v => v.channelId === appState.selectedChannel);

    displayList.forEach(v => {
        const card = document.createElement('div');
        card.className = `video-card ${v.watched ? 'watched' : ''}`; // 既読なら薄くするCSSを適用
        card.innerHTML = `
            <a href="${v.url}" target="_blank" class="thumb-wrapper" onclick="setWatched('${v.id}')">
                <img src="${v.thumb}" loading="lazy">
            </a>
            <div class="video-info">
                <div class="video-title" title="${v.title}">${v.title}</div>
                <div class="channel-name">${v.channelName}</div>
                <div class="meta-row">
                    <label style="cursor:pointer; display:flex; align-items:center; gap:6px;">
                        <input type="checkbox" ${v.watched ? 'checked' : ''} onchange="setWatched('${v.id}')"> 既読
                    </label>
                    <span>${new Date(v.published).toLocaleDateString()}</span>
                </div>
            </div>`;
        container.appendChild(card);
    });
}

/**
 * 動画の既読/未読状態を切り替える
 */
function setWatched(vid) {
    const video = appState.videos.find(v => v.id === vid);
    if (video) {
        // 現在の状態を反転(トグル)させる
        video.watched = !video.watched;
        save();
        renderVideos();
    }
}

/**
 * 表示されているすべての動画を既読にする
 */
function markAllWatched() {
    const currentList = appState.selectedChannel === 'all' 
        ? appState.videos 
        : appState.videos.filter(v => v.channelId === appState.selectedChannel);
        
    currentList.forEach(v => v.watched = true);
    save();
    renderVideos();
}

/**
 * サイドバーで選択したチャンネルでフィルタをかける
 */
function filterChan(id) {
    appState.selectedChannel = id;
    save();
    renderChannels();
    renderVideos();
}

/**
 * ダークモードとライトモードの切り替え
 */
function toggleTheme() {
    appState.darkMode = !appState.darkMode;
    document.body.setAttribute('data-theme', appState.darkMode ? 'dark' : 'light');
    save();
}

/**
 * バックアップ：現在のデータをJSONファイルとして保存する
 */
function exportJSON() {
    const blob = new Blob([JSON.stringify(appState, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yt_rss_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
}

/**
 * 復元：選択したJSONファイルからデータを読み込む
 */
function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            appState = JSON.parse(event.target.result);
            save();
            location.reload(); // 読み込み後はページをリフレッシュして全反映
        } catch (err) { alert("無効なJSONファイルです"); }
    };
    reader.readAsText(file);
}

/**
 * 初期化（全消去）
 */
function resetAll() {
    if (confirm("すべての設定と既読情報を削除しますか？")) {
        localStorage.removeItem('yt_v5_final');
        location.reload();
    }
}

/**
 * ページ読み込み完了時の処理
 */
window.onload = () => {
    load(); // ストレージからデータを読み込む
    //refreshAll();
};