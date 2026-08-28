window.k=console.log//方便用
window.dk=console.dir//方便用
window.els=document.querySelector.bind(document)
window.ela=document.querySelectorAll.bind(document)
document.addEventListener('__picker-store-el0', function (e) {
    // composedPath()[0] 拿到原始目标（Shadow DOM 内的元素也不会被重定向到 host）
    const el = (e.composedPath && e.composedPath()[0]) || e.target;
    window.el0 = el;         
    showNotification('已存入主世界window.el0','success');
	console.log('已存入主世界 window.el0', el);
});
window.CopyAdgRuleToClipboard = function(text) {
    navigator.clipboard.writeText(text)
	.then(() => {
            showNotification('复制成功','success');
        })
	.catch(err => {
        console.error('复制失败:', err);
    });
};

function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: ${type === 'success' ? '#10b981' : '#3b82f6'};
        color: white; padding: 8px 16px; border-radius: 4px;
        font-size: 12px; z-index: 2147483647;
        animation: slideIn 0.3s;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        pointer-events: none;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 1500);
}

