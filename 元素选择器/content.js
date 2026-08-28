// ============================================
// 元素选择器 (完整版，滚动问题已修复 + 样式热编辑 v3: 枚举下拉 + 本地字体 + 定位编辑)
// ============================================

// 状态管理
let currentState = 'a'; // 'a': 普通, 'b': 选择模式, 'd': 锁定模式

window.__ELEMENT_PICKER_STATE = currentState;
window.__ELEMENT_PICKER_ACTIVE = false;

(function () {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    const root = document.body || document.documentElement;
    root.appendChild(iframe);
    const rawAdd = iframe.contentWindow.EventTarget.prototype.addEventListener;
    const rawRemove = iframe.contentWindow.EventTarget.prototype.removeEventListener;
    iframe.remove();
    window.rawAdd = rawAdd;
    window.rawRemove = rawRemove;
    window.rawR = 'csdn傻逼';
})();

// UI元素
let overlay = null;
let tooltip = null;
let exitButton = null;
let shadowHost = null;

// 当前预览的元素
let previewElement = null;
let previewPath = [];
let previewIndex = 0;
let lastMouseX = 0, lastMouseY = 0;

// 锁定的元素
let lockedElement = null;
let lockedInfo = null;
let lockedPath = [];
let lockedIndex = 0;

// 拖动相关（Pointer Events）
let isDragging = false;
let isResizing = false;
let dragOffsetX = 0, dragOffsetY = 0;
let resizeStartX = 0, resizeStartY = 0;
let resizeStartWidth = 0;
let resizeStartHeight = 0;
let dragPointerId = null;
let resizePointerId = null;

// 动画帧ID
let updateOverlayRaf = null;

// 视口尺寸
let lastViewportWidth = window.innerWidth;
let lastViewportHeight = window.innerHeight;

// 悬浮窗尺寸限制
const MIN_WIDTH = 320;
const MIN_HEIGHT = 450;
const MAX_WIDTH = 960;
const MAX_HEIGHT = 900;

// ==================== 导航记忆 (父元素 -> 最近一次从它下来的孩子) ====================
// 🔑 [改动] 新增：+/- 导航的"记忆"机制，j-k-p 场景下从 k 按 + 到 j，
// 再从 j 按 - 能回到 k 而不是 j 的第一个子元素。鼠标移动到别的元素 y 后自动清除。
let navMemory = new WeakMap();

function resetNavMemory() {
    navMemory = new WeakMap();
}

// 兼容 Shadow DOM 的"导航父级"（<x-el> 的宿主也算父级）
function getNavParent(element) {
    if (!element) return null;
    try {
        const root = element.getRootNode();
        if (root instanceof ShadowRoot) return root.host;
    } catch (e) {}
    return (element.parentElement instanceof Element) ? element.parentElement : null;
}

function getFirstNavChild(element) {
    if (!element || !element.children || element.children.length === 0) return null;
    return element.children[0];
}

// 统一刷新锁定态显示
function switchToLockedElement(newEl) {
    lockedElement = newEl;
    lockedInfo = getElementInfo(newEl);
    lockedPath = getFullPath(newEl);
    lockedIndex = Math.max(0, lockedPath.indexOf(newEl));
    updateOverlay(lockedElement);
    let rect = lockedElement.getBoundingClientRect();
    updateTooltip(lockedElement, lockedIndex, lockedPath.length, rect.right, rect.top, true);
}

// 统一刷新预览态显示
function switchToPreviewElement(newEl) {
    previewElement = newEl;
    previewPath = getFullPath(newEl);
    previewIndex = Math.max(0, previewPath.indexOf(newEl));
    updateOverlay(previewElement);
    updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
}

// ==================== Shadow DOM 深度查找 ====================
function findDeepestElementAtPoint(x, y, root = document, depth = 0) {
    try {
        let element = root.elementFromPoint(x, y);
        if (!element) return { element: null, depth: -1 };
        if (element.shadowRoot) {
            const deeper = findDeepestElementAtPoint(x, y, element.shadowRoot, depth + 1);
            if (deeper.element) {
                return deeper;
            }
        }
        return { element, depth };
    } catch (e) {
        return { element: null, depth: -1 };
    }
}

function deepElementFromPoint(x, y) {
    if (window.event && window.event.isTrusted === false) { return null; }
    try {
        const result = findDeepestElementAtPoint(x, y);
        return result.element;
    } catch (e) {
        return document.elementFromPoint(x, y);
    }
}

function getShadowDepth(element) {
    let depth = 0;
    let current = element;
    while (current) {
        try {
            const root = current.getRootNode();
            if (root instanceof ShadowRoot) {
                depth++;
                current = root.host;
            } else {
                break;
            }
        } catch (e) { break; }
    }
    return depth;
}

function getFullPath(element) {
    const path = [];
    let current = element;
    let visited = new Set();
    while (current && !visited.has(current)) {
        visited.add(current);
        path.push(current);
        try {
            const root = current.getRootNode();
            if (root instanceof ShadowRoot) {
                current = root.host;
            } else {
                current = current.parentElement;
            }
        } catch (e) { break; }
    }
    return path;
}

function getSiblings(element) {
    if (!element || !element.parentElement) return [];
    return Array.from(element.parentElement.children);
}

function getPreviousSibling(element) {
    if (!element || !element.parentElement) return null;
    const siblings = getSiblings(element);
    const index = siblings.indexOf(element);
    return index > 0 ? siblings[index - 1] : null;
}

function getNextSibling(element) {
    if (!element || !element.parentElement) return null;
    const siblings = getSiblings(element);
    const index = siblings.indexOf(element);
    return index < siblings.length - 1 ? siblings[index + 1] : null;
}

function getSiblingPosition(element) {
    if (!element || !element.parentElement) return { index: 1, total: 1 };
    const siblings = getSiblings(element);
    const index = siblings.indexOf(element) + 1;
    const total = siblings.length;
    return { index, total };
}

// ==================== UI 创建 (Shadow DOM Open) ====================
function createUI() {
    overlay = document.createElement('div');
    overlay.id = 'element-picker-overlay';
    overlay.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 2147483646;
        border: 2px solid #3b82f6;
        background: rgba(59, 130, 246, 0.1);
        transition: all 0.1s ease;
        display: none;
    `;
    document.documentElement.appendChild(overlay);

    shadowHost = document.createElement('div');
    shadowHost.id = 'element-picker-shadow-host';
    shadowHost.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 0; height: 0;
        z-index: 2147483647;
        pointer-events: none;
    `;
    document.documentElement.appendChild(shadowHost);

    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    const styleSheet = document.createElement('style');
    styleSheet.textContent = `
        :host {
            all: initial;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
        }
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to   { transform: translateX(0); opacity: 1; }
        }
        kbd {
            font-size: 13px;
            color: #62b5ff;
            background: #1e293b;
            padding: 2px 4px;
            border-radius: 3px;
            border: 1px solid #4b5563;
        }
        #tooltip {
            position: fixed;
            z-index: 2147483647;
            background: #1e293b;
            color: white;
            border-radius: 8px;
            font-size: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            border: 1px solid #4b5563;
            min-width: ${MIN_WIDTH}px;
            min-height: ${MIN_HEIGHT}px;
            max-width: ${MAX_WIDTH}px;
            max-height: ${MAX_HEIGHT}px;
            width: ${MIN_WIDTH}px;
            height: ${MIN_HEIGHT}px;
            display: none;
            overflow: hidden;
            box-sizing: border-box;
            pointer-events: auto;
            /* 移除 touch-action: none，允许触摸/触摸板滚动 */
        }
        #tooltip.mode-preview {
            pointer-events: none;
        }
        #tooltip button {
            background: #4f46e5;
            color: white;
            border: none;
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 9px;
            cursor: pointer;
            margin-left: 4px;
            transition: opacity 0.2s;
        }
        #tooltip button:hover {
            opacity: 0.9;
        }
        #tooltip::-webkit-scrollbar {
            width: 6px;
            background: #2d3748;
        }
        #tooltip::-webkit-scrollbar-thumb {
            background: #4b5563;
            border-radius: 3px;
        }
        #exit-btn {
            position: fixed;
            top: 20px;
            left: 20px;
            z-index: 2147483648;
            background: #ef4444;
            color: white;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: none;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            border: 2px solid white;
            transition: all 0.2s;
            pointer-events: auto;
        }
        /* ===== 样式热编辑面板 v3 ===== */
        #style-panel input[type="text"] {
            outline: none;
        }
        #style-panel input[type="text"]:focus {
            border-color: #62b5ff !important;
        }
        #style-panel input[type="color"] {
            padding: 0;
        }
        #style-panel select {
            outline: none;
        }
        #style-panel select:focus {
            border-color: #62b5ff !important;
        }
        #style-panel details summary::-webkit-details-marker {
            color: #6b7280;
        }
        #style-panel details[open] summary {
            margin-bottom: 4px;
        }
    `;
    shadowRoot.appendChild(styleSheet);

    tooltip = document.createElement('div');
    tooltip.id = 'tooltip';
    shadowRoot.appendChild(tooltip);

    exitButton = document.createElement('div');
    exitButton.id = 'exit-btn';
    exitButton.innerHTML = '×';
    exitButton.title = '退出选择模式 (ESC 或 `)';
    shadowRoot.appendChild(exitButton);

    exitButton.addEventListener('click', (e) => {
        e.stopPropagation();
        handleExit();
    });

    window.addEventListener('scroll', handleScrollResize, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });
}

// ==================== 自定义调整大小（Pointer Events） ====================
function initResizeHandles() {
    const oldHandles = tooltip.querySelectorAll('.resize-handle');
    oldHandles.forEach(h => h.remove());

    const handles = ['nw', 'ne', 'sw', 'se'];
    handles.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `resize-handle resize-${pos}`;
        handle.style.cssText = `
            position: absolute;
            width: 16px;
            height: 16px;
            background: #4b5563;
            border: 2px solid #94a3b8;
            border-radius: 4px;
            z-index: 10;
            cursor: ${pos}-resize;
            touch-action: none;
        `;
        if (pos.includes('n')) handle.style.top = '-2px';
        else handle.style.bottom = '-2px';
        if (pos.includes('w')) handle.style.left = '-2px';
        else handle.style.right = '-2px';

        window.rawAdd.call(handle, 'pointerdown', (e) => startResize(e, pos), true);
        tooltip.appendChild(handle);
    });
}

function startResize(e, position) {
    e.stopPropagation();
    e.preventDefault();
    isResizing = true;
    resizePointerId = e.pointerId;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartWidth = tooltip.offsetWidth;
    resizeStartHeight = tooltip.offsetHeight;
    try { e.target.setPointerCapture(resizePointerId); } catch (err) {}
    window.rawAdd.call(document, 'pointermove', onResize, true);
    window.rawAdd.call(document, 'pointerup', stopResize, true);
    window.rawAdd.call(document, 'pointercancel', stopResize, true);
}

function onResize(e) {
    if (!isResizing || e.pointerId !== resizePointerId) return;
    let newWidth = resizeStartWidth + (e.clientX - resizeStartX);
    let newHeight = resizeStartHeight + (e.clientY - resizeStartY);
    newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth));
    newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, newHeight));
    tooltip.style.width = newWidth + 'px';
    tooltip.style.height = newHeight + 'px';
    ensureTooltipInViewport();
}

function stopResize(e) {
    if (isResizing && e && e.pointerId === resizePointerId) {
        try { e.target.releasePointerCapture?.(resizePointerId); } catch (err) {}
    }
    isResizing = false;
    resizePointerId = null;
    window.rawRemove.call(document, 'pointermove', onResize, true);
    window.rawRemove.call(document, 'pointerup', stopResize, true);
    window.rawRemove.call(document, 'pointercancel', stopResize, true);
}

// ==================== 样式热编辑 (v3: 枚举下拉 + 本地字体 + 定位) ====================
// 🔑 元素 -> 原始内联 cssText 备份，用于一键还原
const styleBackupMap = new WeakMap();

const COLOR_PROPS = ['color', 'background-color', 'border-color'];
const NEED_UNIT_PROPS = ['width', 'height', 'font-size', 'line-height',
    'letter-spacing', 'gap', 'margin', 'padding',
    'top', 'right', 'bottom', 'left'];   // 🔑 [新增] 定位偏移纯数字自动补 px

// ---- 🔑 枚举值定义：value -> 中文说明（下拉框选项）----
const STYLE_ENUMS = {
    'display': {
        'block':         '块级·独占一行',
        'inline':        '行内·不换行不可设宽高',
        'inline-block':  '行内块·同行且可设宽高',
        'flex':          '弹性布局·子元素横排',
        'inline-flex':   '行内弹性布局',
        'grid':          '网格布局·二维排列',
        'inline-grid':   '行内网格布局',
        'flow-root':     '块级·自带BFC·清浮动',
        'table':         '表格·行为像<table>',
        'table-row':     '表格行·行为像<tr>',
        'table-cell':    '表格单元格·可垂直居中',
        'list-item':     '列表项·带圆点编号',
        'contents':      '自身消失·子元素顶替位置',
        'none':          '隐藏·不占空间',
    },
    'text-align': {          // 【左/右对齐在这里】元素内部文字的水平对齐
        'left':    '文字左对齐',
        'center':  '文字居中',
        'right':   '文字右对齐',
        'justify': '文字两端对齐',
    },
    'justify-content': {     // flex/grid 容器：子元素沿【主轴】的排列（横排时=水平）
        'flex-start':    '子元素靠左/起点',
        'center':        '子元素居中',
        'flex-end':      '子元素靠右/终点',
        'space-between': '均匀分布·两端贴边',
        'space-around':  '均匀分布·两侧半空隙',
        'space-evenly':  '完全均匀·空隙全相等',
    },
    'align-items': {         // flex/grid 容器：子元素沿【交叉轴】的对齐（横排时=垂直）
        'stretch':    '子元素拉伸填满(默认)',
        'flex-start': '子元素顶对齐',
        'center':     '子元素垂直居中',
        'flex-end':   '子元素底对齐',
        'baseline':   '子元素按文字基线对齐',
    },
    'align-self': {          // 本元素覆盖父容器的 align-items
        'auto':       '继承父容器设置',
        'flex-start': '自己在父容器中顶对齐',
        'center':     '自己在父容器中垂直居中',
        'flex-end':   '自己在父容器中底对齐',
        'stretch':    '自己拉伸填满',
    },
    'flex-direction': {      // 主轴方向
        'row':            '横向·从左到右(默认)',
        'row-reverse':    '横向·从右到左',
        'column':         '纵向·从上到下',
        'column-reverse': '纵向·从下到上',
    },
    // 🔑 gap：常用间距档位（任意值仍可在文本框输入，如 8px 16px 分行列）
    'gap': {
        '0px':  '无间距',   '2px': '超小间距', '4px':  '小间距',
        '8px':  '较小间距', '12px':'中偏小',   '16px': '中档间距(常用)',
        '24px': '中偏大',   '32px':'大间距',   '48px': '超大间距',
    },
    // 🔑 [新增] 定位
    'position': {
        'static':   '静态·默认·随文档流',
        'relative': '相对·占原位·可微调top等',
        'absolute': '绝对·脱离文档流·相对最近定位祖先',
        'fixed':    '固定·钉死在屏幕上·不随滚动',
        'sticky':   '粘性·滚动到阈值时钉住',
    },
	'top': {
        '0px':  '贴顶·贴上边缘',
        '8px':  '上偏移8px·小间距',
        '16px': '上偏移16px·常用于固定顶栏',
        '50%':  '垂直中点·常配合transform微调',
        '100%': '下边界·完全移出上方',
        '-20px': '向上越界20px·角标外挂常用',
    },
    'right': {
        '0px':  '贴右·贴右边缘',
        '8px':  '右偏移8px·小间距',
        '16px': '右偏移16px·常用于关闭按钮',
        '50%':  '水平中点',
        '100%': '左边界·完全移出右侧',
        '-20px': '向右越界20px·角标外挂常用',
    },
    'bottom': {
        '0px':  '贴底·贴下边缘',
        '8px':  '下偏移8px·小间距',
        '16px': '下偏移16px·常用于吸底按钮',
        '50%':  '垂直中点',
        '100%': '上边界·完全移出下方',
        '-20px': '向下越界20px',
    },
    'left': {
        '0px':  '贴左·贴左边缘',
        '8px':  '左偏移8px·小间距',
        '16px': '左偏移16px·常用于侧边面板',
        '50%':  '水平中点·居中常用',
        '100%': '右边界·完全移出左侧',
        '-20px': '向左越界20px',
    },
    // 🔑 z-index：常用层级档位
    'z-index': {
        'auto': '默认层级·跟DOM顺序',
        '0': '普通层', '1': '略高一层',
        '10': '中高', '100': '很高',
        '9999': '顶级·压住普通弹层',
        '-1':   '沉底·垫在内容后面',
    },
    // 🔑 overflow：内容溢出处理
    'overflow': {
        'visible': '溢出直接显示(默认)',
        'hidden':  '溢出裁剪隐藏',
        'scroll':  '始终显示滚动条',
        'auto':    '溢出时才出滚动条',
    },
    'overflow-x': {
        'visible': '横向溢出显示', 'hidden': '横向裁剪',
        'scroll': '横向滚动条', 'auto': '需要时横向滚动',
    },
    'overflow-y': {
        'visible': '纵向溢出显示', 'hidden': '纵向裁剪',
        'scroll': '纵向滚动条', 'auto': '需要时纵向滚动',
    },
    'font-weight': {
        '300': '细体', '400': '常规(默认)', '500': '中等',
        '600': '半粗', '700': '粗体', '900': '极粗',
        'normal': '常规(=400)', 'bold': '粗体(=700)',
    },
};

// ---- 字体管理 ----
const FALLBACK_FONTS = [
    'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong',
    'PingFang SC', 'Noto Sans CJK SC',
    'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Garamond',
    'Courier New', 'Consolas', 'Verdana', 'Tahoma', 'Impact',
    'Segoe UI', 'Roboto', 'system-ui', 'sans-serif', 'serif', 'monospace',
];
let fontFamilies = [...FALLBACK_FONTS];
let importedFontFaces = []; // 🔑 保持 FontFace 引用，防止被 GC 回收

const STYLE_GROUPS = [
    { title: '📐 尺寸',        props: ['width', 'height'], open: true },
    { title: '🎨 颜色',        props: ['color', 'background-color', 'border-color', 'opacity'], open: true },
    { title: '🔤 字体',        props: ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing'], open: false },
    { title: '🎯 对齐 / 布局', props: ['display', 'text-align', 'justify-content', 'align-items', 'align-self', 'flex-direction', 'gap', 'margin', 'padding'], open: false },
    // 🔑 [新增] 定位分组：position 定模式，top/right/bottom/left 定偏移
    { title: '📌 定位',        props: ['position', 'top', 'right', 'bottom', 'left', 'z-index', 'overflow', 'overflow-x', 'overflow-y'], open: false },
];

function escapeHtmlAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function rgbToHex(c) {
    if (!c) return '#000000';
    if (c[0] === '#') return c.length === 4
        ? '#' + c[1]+c[1]+c[2]+c[2]+c[3]+c[3] : c;
    const m = c.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return '#000000';
    return '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('');
}

function normalizeStyleValue(prop, v) {
    if (v === '') return '';
    // 纯数字自动补 px（如输入 100 → 100px）
    if (NEED_UNIT_PROPS.includes(prop) && /^\d+(\.\d+)?$/.test(v)) return v + 'px';
    return v;
}

function backupInlineStyle(el) {
    if (el && !styleBackupMap.has(el)) styleBackupMap.set(el, el.style.cssText);
}

function applyStyleValue(el, prop, value) {
    if (!el || currentState === 'a') return;
    backupInlineStyle(el);
    if (value === '' || value == null) el.style.removeProperty(prop);
    else el.style.setProperty(prop, value);
    // 同步蓝/绿框位置（改了宽高/定位后框要跟着动）
    if (currentState === 'd' && el === lockedElement) updateOverlay(lockedElement);
    else if (currentState === 'b' && el === previewElement) updateOverlay(previewElement);
}

function resetElementStyles(el) {
    if (!el) return;
    const backup = styleBackupMap.get(el);
    if (backup === undefined) {
        showNotification('该元素没有修改过样式', 'info');
        return;
    }
    el.style.cssText = backup;
    styleBackupMap.delete(el);
    updateOverlay(el);
    showNotification('已恢复原样式', 'success');
    // 重刷面板
    if (currentState === 'd' && el === lockedElement) {
        const rect = el.getBoundingClientRect();
        updateTooltip(el, lockedIndex, lockedPath.length, rect.right, rect.top, true);
    } else if (currentState === 'b' && el === previewElement) {
        updateTooltip(el, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
    }
}

// ---- 字体：扫描本机 / 导入文件 ----
function rebuildFontSelect(panel, el, selectedName) {
    const sel = panel.querySelector('.font-select');
    if (!sel) return;
    const cur = selectedName || (el ? el.style.getPropertyValue('font-family').replace(/['"]/g, '').split(',')[0].trim() : '');
    sel.innerHTML = '<option value="">— 选择字体 —</option>';
    fontFamilies.forEach(f => {
        const o = document.createElement('option');
        o.value = f;
        o.textContent = f;
        try { o.style.fontFamily = `'${f}'`; } catch (e) {} // 选项用自己的字体渲染预览
        if (f === cur) o.selected = true;
        sel.appendChild(o);
    });
}

function scanLocalFonts(panel, el) {
    if (typeof window.queryLocalFonts !== 'function') {
        showNotification('浏览器不支持扫描本机字体（需 Chrome 103+ 且 manifest 声明 local-fonts 权限）', 'info');
        return;
    }
    window.queryLocalFonts().then(fonts => {
        const fams = [...new Set(fonts.map(f => f.family))];
        fontFamilies = [...new Set([...fams, ...fontFamilies])];
        rebuildFontSelect(panel, el);
        showNotification(`✅ 已把 ${fams.length} 个本机字体加入下拉框`, 'success');
    }).catch(() => {
        showNotification('本机字体扫描被拒绝（需在权限弹窗中点允许）', 'info');
    });
}

function importFontFile(file, panel, el) {
    if (!file) return;
    const name = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').trim() || 'ImportedFont';
    file.arrayBuffer()
        .then(buf => new FontFace(name, buf).load())
        .then(ff => {
            document.fonts.add(ff);          // 🔑 注册到 document.fonts，全页可用
            importedFontFaces.push(ff);
            if (!fontFamilies.includes(name)) fontFamilies.unshift(name);
            rebuildFontSelect(panel, el, name);
            const input = panel.querySelector('.style-input[data-prop="font-family"]');
            if (input) input.value = `'${name}'`;
            applyStyleValue(el, 'font-family', `'${name}'`);
            showNotification(`字体 "${name}" 导入成功并已应用`, 'success');
        })
        .catch(err => showNotification('字体导入失败: ' + (err.message || err), 'info'));
}


function buildCopyOnClick(text) {
    const js = String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const attr = js.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    return `CopyAdgRuleToClipboard("${attr}")`;
}
// ---- 面板渲染 ----
function renderStylePanel(el, isLocked) {
    if (!el) return '';
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { return ''; }

    const inputBaseStyle = (edited) => `flex:1;min-width:0;background:${edited ? '#0f2b1e' : '#0f172a'};
        color:${edited ? '#34d399' : '#fbbf24'};border:1px solid ${edited ? '#10b981' : '#4b5563'};
        border-radius:3px;padding:2px 4px;font-size:10px;font-family:monospace;`;
    const selectStyle = `background:#0f172a;color:#fbbf24;border:1px solid #4b5563;border-radius:3px;
        padding:2px;font-size:10px;font-family:monospace;max-width:120px;flex-shrink:0;cursor:pointer;`;

    let html = `<div id="style-panel" style="margin:8px 0;background:#1a2332;padding:8px;border-radius:4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="color:#94a3b8;font-weight:500;">🎨 样式 ${isLocked
                ? '<span style="color:#10b981;font-size:10px;">可热编辑·清空恢复</span>'
                : '<span style="color:#f59e0b;font-size:10px;">锁定后可编辑</span>'}</span>
            ${styleBackupMap.has(el)
                ? `<button id="style-reset" style="background:#ef4444;color:#fff;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">↩ 重置样式</button>` : ''}
        </div>
        <div style="color:#6b7280;font-size:10px;margin-bottom:4px;">实时尺寸: <span id="style-live-size" style="color:#fbbf24;">${Math.round(el.offsetWidth)} × ${Math.round(el.offsetHeight)}</span></div>`;

    for (const group of STYLE_GROUPS) {
        html += `<details style="margin:4px 0;background:#2d3748;border-radius:4px;padding:4px 6px;" ${group.open ? 'open' : ''}>
            <summary style="cursor:pointer;color:#a5b4fc;font-size:11px;user-select:none;">${group.title}</summary>`;
        for (const prop of group.props) {
            const computed = cs.getPropertyValue(prop).trim();
            const inline = el.style.getPropertyValue(prop).trim();
            const shown = inline || computed;
            const isColor = COLOR_PROPS.includes(prop);
            const enumDef = STYLE_ENUMS[prop];
            const isFont = prop === 'font-family';
            const edited = !!inline;

            /*html += `<div style="display:flex;align-items:center;gap:4px;margin:3px 0;font-size:10px;flex-wrap:wrap;">
                <span style="color:#94a3b8;min-width:86px;flex-shrink:0;" title="${prop}">${prop}</span>`;*/
			html += `<div style="display:flex;align-items:center;gap:4px;margin:3px 0;font-size:10px;flex-wrap:wrap;">
    <span class="style-label" data-prop="${prop}"
          style="color:#94a3b8;min-width:86px;flex-shrink:0;"
          onclick="CopyAdgRuleToClipboard('${prop}: ${shown};')"
          title="${prop}">${prop}</span>`;
	
		
            // 字体下拉 + 扫描/导入按钮
            if (isFont) {
                html += `<select class="font-select" ${isLocked ? '' : 'disabled'} style="${selectStyle}max-width:130px;">
                    <option value="">— 选择字体 —</option>`;
                fontFamilies.forEach(f => {
                    const sel = (shown === `'${f}'` || shown === `"${f}"` || shown === f) ? ' selected' : '';
                    html += `<option value="${escapeHtmlAttr(f)}"${sel} style="font-family:'${escapeHtmlAttr(f)}'">${escapeHtmlAttr(f)}</option>`;
                });
                html += `</select>
                <button class="font-scan" ${isLocked ? '' : 'disabled'} title="扫描本机全部字体" style="background:#374151;color:#fff;border:none;border-radius:3px;padding:2px 5px;font-size:10px;cursor:pointer;">🌐</button>
                <button class="font-import" ${isLocked ? '' : 'disabled'} title="导入本地字体文件" style="background:#374151;color:#fff;border:none;border-radius:3px;padding:2px 5px;font-size:10px;cursor:pointer;">📂</button>
                <input type="file" class="font-file" accept=".ttf,.otf,.woff,.woff2,.ttc" style="display:none;">`;
            }
            // 枚举下拉框
            else if (enumDef) {
                html += `<select class="style-enum" data-prop="${prop}" ${isLocked ? '' : 'disabled'} style="${selectStyle}">
                    <option value="">自定义…</option>`;
                let matched = false;
                for (const [val, desc] of Object.entries(enumDef)) {
                    const s = shown === val ? ' selected' : '';
                    if (s) matched = true;
                    html += `<option value="${val}"${s}>${val} · ${desc}</option>`;
                }
                if (!matched && shown) {
                    html += `<option value="${escapeHtmlAttr(shown)}" selected>${escapeHtmlAttr(shown)} · (当前值)</option>`;
                }
                html += `</select>`;
            }

            if (isColor) {
                html += `<input type="color" class="style-color" data-prop="${prop}"
                    value="${rgbToHex(inline || computed)}" ${isLocked ? '' : 'disabled'}
                    style="width:22px;height:18px;border:none;background:none;cursor:pointer;flex-shrink:0;">`;
            }

            html += `<input type="text" class="style-input" data-prop="${prop}" spellcheck="false"
                value="${escapeHtmlAttr(shown)}" ${isLocked ? '' : 'disabled'}
                style="${inputBaseStyle(edited)}">
            </div>`;
        }
        html += `</details>`;
    }
    html += `</div>`;
    return html;
}

// ==================== 祖先链 ====================
function getAncestorChain(element) {
    if (!element) return '';
    const path = getFullPath(element);
    let html = '<div style="margin: 12px 0; background: #2d3748; padding: 10px; border-radius: 6px;">';
    html += '<div style="color: #94a3b8; margin-bottom: 6px; font-weight: 500;">📋 祖先链 (共 ' + path.length + ' 级):</div>';

    for (let i = 0; i < path.length; i++) {
        const el = path[i];
        const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
        const id = el.id ? `#${el.id}` : '';
        let classText = '';
        if (el.classList && el.classList.length > 0) {
            classText = '.' + Array.from(el.classList).slice(0, 2).join('.');
            if (el.classList.length > 2) classText += '…';
        }
        const shadowDepth = getShadowDepth(el);
        const isInShadow = shadowDepth > 0;
        const bgColor = i === 0 ? '#3b82f6' : `rgba(55, 65, 81, ${1 - i * 0.1})`;
        const shadowMark = isInShadow ? '⚡'.repeat(shadowDepth) + ' ' : '';

        html += `<div style="
                    padding: 5px 10px;
                    margin: 3px 0;
                    background: ${bgColor};
                    border-radius: 4px;
                    font-size: 11px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    border-left: 2px solid ${i === 0 ? '#fbbf24' : '#4b5563'};
                ">
                    <span style="color: #94a3b8; min-width: 24px;">${i + 1}.</span>
                    <span style="color: ${i === 0 ? 'white' : '#fbbf24'}; word-break: break-all; flex: 1;"
                          onclick='CopyAdgRuleToClipboard("${tag}${id}${classText}")'
                          title="复制selector">
                        ${shadowMark}${tag}${id}${classText}
                    </span>
                    ${i === 0 ? '<span style="color: #fbbf24; font-size: 10px;">当前元素</span>' : ''}
                    ${isInShadow ? `<span style="color: #a5b4fc; font-size: 10px;">Shadow深度:${shadowDepth}</span>` : ''}
                </div>`;
    }
    html += '</div>';
    return html;
}

// ==================== 元素信息提取 ====================
function generateSelector(el) {
    if (!el) return '';
    try {
        if (el.id) return `#${el.id}`;
        if (el.classList && el.classList.length > 0) {
            return `${el.tagName.toLowerCase()}${Array.from(el.classList).map(c => `.${c}`).join('')}`;
        }
        return el.tagName.toLowerCase();
    } catch (e) {
        return '';
    }
}

function generateSelector2(el) {
    if (!(el instanceof Element)) return '';
    const ok = (root, sel, t) => {
        try { const h = root.querySelectorAll(sel); return h.length === 1 && h[0] === t; }
        catch (e) { return false; }
    };
    if (el.id && ok(document, `#${CSS.escape(el.id)}`, el)) return `#${CSS.escape(el.id)}`;

    // 沿祖先链（含 Shadow host）拼路径，每层验证一次
    const parts = [];
    let cur = el;
    while (cur instanceof Element) {
        const seg = cur.tagName === 'HTML' ? ':root'
            : cur.tagName.toLowerCase()
              + (cur.classList[0] ? '.' + CSS.escape(cur.classList[0]) : '');
        const same = cur.parentElement
            ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur.tagName)
            : [];
        if (same.length > 1) parts.unshift(`${seg}:nth-of-type(${same.indexOf(cur) + 1})`);
        else parts.unshift(seg);

        // 到达某个 root 的顶层时先试整条（或试到能唯一定位 host 为止）
        const full = parts.join(' > ');
        if (ok(document, full, el)) return full;

        let up = cur.parentElement;
        if (!up) {
            // 🔑 parentElement 为 null：要么是 <html>，要么是 Shadow Root 的孩子
            const root = cur.getRootNode();
            if (!(root instanceof ShadowRoot)) break;          // 普通 DOM 到底了
            // 退而求其次：用简化片段继续往宿主方向记，最后统一标 " >> "
            parts.unshift(root.host.tagName.toLowerCase());
            parts.push('>>');                                   // 标记跨边界
            cur = root.host;
            continue;
        }
        cur = up;
    }
    return ok(document, parts.join(' > '), el)
        ? parts.join(' > ')
        : '';   // 🔑 验证不过就老实返回空，不吐假选择器
}

function generateXPath(el) {
    if (!el) return '';
    try {
        if (el.id) {
            return `//*[@id="${el.id}"]`;
        }
        const parts = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            if (current.id) {
                parts.unshift(`//*[@id="${current.id}"]`);
                break;
            }
            let part = current.tagName.toLowerCase();
            if (current.parentElement) {
                const siblings = Array.from(current.parentElement.children)
                    .filter(c => c.tagName === current.tagName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
                    part += `[${index}]`;
                }
            }
            parts.unshift(part);
            current = current.parentElement;
        }
        if (parts[0] && parts[0].startsWith('//')) {
            return parts.join('/');
        } else {
            return '/' + parts.join('/');
        }
    } catch (e) {
        return '';
    }
}

function getElementInfo(el) {
    if (!el) return { tag: 'unknown' };
    try {
        const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
        const id = el.id ? `#${el.id}` : '';
        let classList = [];
        if (el.classList && el.classList.length > 0) {
            classList = Array.from(el.classList);
        }
        const attributes = [];
        if (el.attributes) {
            for (let attr of el.attributes) {
                attributes.push({ name: attr.name, value: attr.value });
            }
        }
        const shadowDepth = getShadowDepth(el);
        const isInShadow = shadowDepth > 0;
        let displayName = tag;
        if (id) displayName += id;
        if (classList.length > 0) {
            const shortClasses = classList.slice(0, 2).map(c => `.${c}`).join('');
            displayName += shortClasses;
            if (classList.length > 2) displayName += ` +${classList.length - 2}`;
        }
        if (isInShadow) {
            displayName = '⚡'.repeat(shadowDepth) + ' ' + displayName;
        }
        return {
            tag, id, classList, attributes,
            displayName,
            isInShadow,
            shadowDepth,
            innerText: el.innerText ? el.innerText.substring(0, 500) : '',
            childCount: el.children ? el.children.length : 0,
            cssSelector: generateSelector(el) + '\n\n' + generateSelector2(el),
            xpath: generateXPath(el),
            siblingPos: getSiblingPosition(el),
            element: el
        };
    } catch (e) {
        return { tag: 'error', displayName: '获取信息失败' };
    }
}

// ==================== 控制台输出 ====================
function logElementInfo(el, type = 'locked') {
    if (!el) return;
    //window.pickedel0=el;
    const info = getElementInfo(el);
    const prefix = type === 'locked' ? '🔒 已锁定元素' : '📍 定位元素';

    console.log(`%c${prefix}:`,
        'background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
        el);

    if (info.id) console.log(`%c📋 ID: ${info.id}`, 'color: #94a3b8;');
    if (info.classList.length > 0) console.log(`%c📋 类名: ${info.classList.join(' ')}`, 'color: #94a3b8;');
    if (info.isInShadow) console.log(`%c⚡ 位于 Shadow DOM 中 (深度: ${info.shadowDepth})`, 'color: #fbbf24;');
    if (info.cssSelector) console.log(`%c🔧 CSS选择器: ${info.cssSelector}`, 'color: #0c8a60;');
    if (info.xpath) console.log(`%c🔧 XPath: ${info.xpath}`, 'color: #0c8a60;');
    //showNotification(`已输出元素信息到控制台`, 'success');
}

// ==================== 统一的锁定/解锁入口 ====================
let highlightTimer = null;

function lockCurrentElement(source = 'keyboard') {
    if (currentState !== 'b' || !previewElement) {
        showNotification('没有可锁定的元素', 'info');
        return false;
    }

    console.log(`🔒 锁定元素 (来源: ${source})`);
    lockedElement = previewElement;
    lockedInfo = getElementInfo(lockedElement);
    lockedPath = getFullPath(lockedElement);
    lockedIndex = lockedPath.indexOf(lockedElement);
    if (lockedIndex === -1) lockedIndex = 0;
    currentState = 'd';
    window.__ELEMENT_PICKER_STATE = 'd';
    window.__ELEMENT_PICKER_ACTIVE = true;
    tooltip.classList.remove('mode-preview');

    logElementInfo(lockedElement, 'locked');

    window.rawRemove.call(document, 'pointermove', handleMouseMove, true);
    document.removeEventListener('wheel', handleWheel, { passive: false });

    updateOverlay(lockedElement);
    let rect = lockedElement.getBoundingClientRect();
    updateTooltip(lockedElement, lockedIndex, lockedPath.length, rect.right, rect.top, true);
    updateExitButton();

    showNotification('已锁定 - 使用Numpad0解锁，ESC退出', 'success');

    let event = new CustomEvent('element-picker-state-change',
        { detail: { state: 'locked', source: source } });
    document.dispatchEvent(event);

    setTimeout(() => {
        if (currentState === 'd' && lockedElement) {
            const activeElement = document.activeElement;
            const isFocusInLockedElement = lockedElement.contains(activeElement);

            if (!isFocusInLockedElement) {
                try {
                    const focusableElements = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'];
                    if (focusableElements.includes(lockedElement.tagName) ||
                        lockedElement.hasAttribute('tabindex') ||
                        lockedElement.isContentEditable) {
                        lockedElement.focus();
                    } else {
                        const focusableChild = lockedElement.querySelector(
                            'input, textarea, button, select, a, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]');
                        if (focusableChild) focusableChild.focus();
                        else {
                            lockedElement.setAttribute('tabindex', '-1');
                            lockedElement.focus();
                        }
                    }

                    // 🔑 [改动] 只动 outline，避免整体 cssText 回滚抹掉用户的热编辑样式
                    if (1)(function () {
                        if (highlightTimer) clearTimeout(highlightTimer);
                        const el = lockedElement;
                        el.style.outline = '2px solid #10b981';
                        el.style.outlineOffset = '2px';
                        highlightTimer = setTimeout(() => {
                            el.style.removeProperty('outline');
                            el.style.removeProperty('outline-offset');
                            highlightTimer = null;
                        }, 1000);
                    })();

                } catch (e) {
                    console.warn('自动聚焦失败:', e);
                }
            }
        }
    }, 500);

    return true;
}

function unlockCurrentElement(source = 'keyboard') {
    if (currentState !== 'd' || !lockedElement) {
        showNotification('没有锁定的元素', 'info');
        return false;
    }

    console.log(`🔓 解锁元素 (来源: ${source})`);
    lockedElement = null;
    lockedInfo = null;
    lockedPath = [];
    lockedIndex = 0;
    currentState = 'b';
    window.__ELEMENT_PICKER_STATE = 'b';
    window.__ELEMENT_PICKER_ACTIVE = true;
    tooltip.classList.add('mode-preview');

    window.rawAdd.call(document, 'pointermove', handleMouseMove, true);
    document.addEventListener('wheel', handleWheel, { passive: false });

    if (previewElement) {
        updateOverlay(previewElement);
        updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
    } else {
        overlay.style.display = 'none';
        tooltip.style.display = 'none';
    }

    updateExitButton();
    showNotification('返回选择模式', 'info');

    let event = new CustomEvent('element-picker-state-change',
        { detail: { state: 'preview', source: source } });
    document.dispatchEvent(event);
    return true;
}

// ==================== 退出处理 ====================
function handleExit() {
    if (currentState === 'd') {
        unlockCurrentElement('exit');
    } else if (currentState === 'b') {
        exitSelectMode();
    }
    updateExitButton();
}

function updateExitButton() {
    if (!exitButton) return;
    exitButton.style.display = (currentState === 'b' || currentState === 'd') ? 'flex' : 'none';
}

function generateAdGuardRules(attr) {
    let rules = [];
    let host = window.location.hostname;
    let name = attr.name;
    let value = attr.value;
    if (!name || !value) return rules;

    switch (name) {
        case 'class':
            if (value) {
                let classes = value.split(/\s+/);
                classes.forEach(cls => {
                    if (cls.trim()) {
                        rules.push({ rule: `${host}##.${cls}`, desc: `类名选择器: .${cls}` });
                    }
                });
                rules.push({ rule: `${host}##[class="${value}"]`, desc: `精确类名匹配: [class="${value}"]` });
                if (classes[0]) {
                    rules.push({ rule: `${host}##[class*="${classes[0]}"]`, desc: `模糊类名匹配: [class*="${classes[0]}"]` });
                }
            }
            break;
        case 'id':
            rules.push({
                rule: `${host}##${value.startsWith('#') ? value : '#' + value}`,
                desc: `ID选择器: ${value.startsWith('#') ? value : '#' + value}`
            });
            break;
        case 'href':
        case 'src':
            if (value) {
                let ext = value.split('.').pop();
                if (ext && ext.length < 10) {
                    rules.push({ rule: `${host}##[${name}$=".${ext}"]`, desc: `${name}后缀匹配: [${name}$=".${ext}"]` });
                }
                let prefix = value.substring(0, Math.min(20, value.length));
                rules.push({ rule: `${host}##[${name}^="${prefix}"]`, desc: `${name}开头匹配: [${name}^="..."]` });
            }
            break;
        default:
            if (name.startsWith('data-')) {
                rules.push({ rule: `${host}##[${name}="${value}"]`, desc: `数据属性: [${name}="${value}"]` });
            } else {
                rules.push({ rule: `${host}##[${name}="${value}"]`, desc: `属性选择器: [${name}="${value}"]` });
            }
    }
    return rules;
}

function injectCopyScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injectclipboard.js');
    script.onload = function () { this.remove(); };
    document.documentElement.appendChild(script);
}

injectCopyScript();

// ==================== 悬浮窗更新 ====================
function updateTooltip(el, index, total, mouseX, mouseY, isLocked) {
    if (!el) return;

    const info = getElementInfo(el);

    let attrsHtml = '<div style="max-height: 150px; overflow-y: auto; pointer-events: auto; margin: 8px 0; background: #2d3748; padding: 8px; border-radius: 4px;">';
    if (info.attributes.length > 0) {
        info.attributes.slice(0, 10).forEach(attr => {
            let value = attr.value;
            if (value.length > 200) value = value.substring(0, 200) + '...';

            let adgRules = generateAdGuardRules(attr);
            attrsHtml += `<div style="margin-bottom: 6px; font-size: 11px; word-break: break-all; border-bottom: 1px solid #4a5568; padding-bottom: 4px;">
                <div style="margin-bottom: 2px;">
                    <span style="color: #94a3b8;">${attr.name}:</span>
                    <span style="color: #fbbf24;">${escapeHtml(value)}</span>
                </div>`;

            if (adgRules.length > 0) {
                attrsHtml += '<div style="margin-left: 12px; margin-top: 4px;">';
                adgRules.forEach(rule => {
                    attrsHtml += `
                        <div style="display: flex; align-items: center; margin-bottom: 3px; font-family: monospace; font-size: 10px; background: #1e293b; padding: 2px 4px; border-radius: 3px;">
                            <span style="color: #a5d6ff; flex: 1;" onclick='CopyAdgRuleToClipboard("${rule.rule.replace(/"/g, '\\"')}")' title="复制规则">${rule.rule}</span>
                            <span style="color: #94a3b8; font-size: 9px; margin: 0 4px;">${rule.desc}</span>
                        </div>
                    `;
                });
                attrsHtml += '</div>';
            }

            attrsHtml += '</div>';
        });
    } else {
        attrsHtml += '<div style="color: #94a3b8;">无属性</div>';
    }
    attrsHtml += '</div>';

    let shadowHtml = '';
    if (info.isInShadow) {
        shadowHtml = `<div style="background: #312e81; color: #a5b4fc; padding: 6px 8px; border-radius: 4px; margin: 8px 0; font-size: 11px;">
            ⚡ 位于 Shadow DOM 中 (深度: ${info.shadowDepth})
        </div>`;
    }

    tooltip.innerHTML = `
        <div id="tooltip-header" style="padding: 10px 12px; cursor: move; background: #0f172a; border-bottom: 1px solid #334155; user-select: none; touch-action: none;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: ${isLocked ? '#10b981' : '#3b82f6'}; font-weight: 600; font-size: 13px;">${info.displayName}</span>
                    <span style="background: #374151; padding: 2px 6px; border-radius: 12px; font-size: 10px;">${info.siblingPos.index}/${info.siblingPos.total}</span>
                </div>
                <span style="background: #374151; padding: 2px 8px; border-radius: 12px; font-size: 10px;">${index + 1}/${total}</span>
            </div>
        </div>
        <div style="padding: 12px; height: calc(100% - 80px); overflow-y: auto; pointer-events: auto;">
            ${shadowHtml}
            <div style="background: #2d3748; padding: 8px; border-radius: 4px; margin: 8px 0;">
                <div><span style="color: #94a3b8;">标签:</span> <span style="color: #fbbf24;">${info.tag}</span></div>
                ${info.id ? `<div><span style="color: #94a3b8;">ID:</span> <span style="color: #fbbf24;">${info.id}</span></div>` : ''}
                <div><span style="color: #94a3b8;">类名数量:</span> <span style="color: #fbbf24;">${info.classList.length}</span></div>
                <div><span style="color: #94a3b8;">子元素数:</span> <span style="color: #fbbf24;">${info.childCount}</span></div>
                <div><span style="color: #94a3b8;">所在网址:</span> <span onclick='CopyAdgRuleToClipboard("${window.location.href}")' title="复制网址" style="color: #fbbf24;word-break: break-all;">${window.location.href}</span></div>
            </div>
            <div style="margin: 8px 0;">
                <div style="color: #94a3b8; margin-bottom: 4px;">属性列表:</div>
                ${attrsHtml}
            </div>
            ${info.innerText ? `
            <div style="margin: 8px 0; background: #2d3748; padding: 8px; border-radius: 4px;">
                <div style="color: #94a3b8; margin-bottom: 4px;">文本内容:</div>
                <div style="color: #9ca3af; max-height: 60px; overflow-y: auto; pointer-events: auto; font-size: 11px;" >${escapeHtml(info.innerText)}</div>
            </div>` : ''}
            ${getAncestorChain(el)}
            ${renderStylePanel(el, isLocked)}
            ${info.cssSelector ? `
            <div style="background: #2d3748; padding: 8px; border-radius: 4px; margin: 8px 0;">
                <div style="color: #94a3b8; margin-bottom: 4px;">CSS选择器:</div>
                <div style="color: #fbbf24; font-size: 11px; word-break: break-all;white-space: pre-wrap;">${escapeHtml(info.cssSelector)}</div>
            </div>` : ''}
            ${info.xpath ? `
            <div style="background: #2d3748; padding: 8px; border-radius: 4px; margin: 8px 0;">
                <div style="color: #94a3b8; margin-bottom: 4px;">XPath:</div>
                <div style="color: #fbbf24; font-size: 11px; word-break: break-all;">${escapeHtml(info.xpath)}</div>
            </div>` : ''}
            <div style="display: flex; gap: 8px; margin-top: 12px;">
                <button id="picker-locate"  style="flex:1; background:#3b82f6; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:500;">📍 存为 window.el0</button>
            </div>
            <div style="margin-top: 8px; font-size: 10px; color: #6b7280; text-align: center; background: #2d3748; padding: 6px; border-radius: 4px;">
                <div><kbd>+</kbd> 祖先 · <kbd>-</kbd> 后代</div>
                <div><kbd>/</kbd> 上一个同级 · <kbd>*</kbd> 下一个同级</div>
                <div><kbd>Numpad0</kbd> 锁定/解锁</div>
                <div><kbd>ESC</kbd> 或 <kbd>\`</kbd> 退出</div>
                ${info.isInShadow ? '<div style="color: #a5b4fc;">⚡ Shadow深度: ' + info.shadowDepth + '</div>' : ''}
            </div>
        </div>
    `;

    setTimeout(() => {
        const locateBtnInShadow = tooltip.querySelector('#picker-locate');
        const header = tooltip.querySelector('#tooltip-header');
        if (locateBtnInShadow) {
            locateBtnInShadow.onclick = (e) => {
                e.stopPropagation();
                //logElementInfo(el, 'locate');
				// 🔑 把当前元素广播给主世界，由主世界写入 window.el0
			el.dispatchEvent(new CustomEvent('__picker-store-el0', {
            bubbles: true,     // 冒泡到 document，主世界监听器才能收到
            composed: true     // 元素在 Shadow DOM 里时也能冒出来
        }));
            };
        }
        if (header) {
            window.rawAdd.call(header, 'pointerdown', startDrag, true);
        }
        initResizeHandles();

        // ===== 🔑 [v3] 样式热编辑绑定（枚举下拉 + 字体 + 定位） =====
        const stylePanel = tooltip.querySelector('#style-panel');
        if (stylePanel) {
            const applyChange = (prop, value) => {
                applyStyleValue(el, prop, value);
                const sizeSpan = stylePanel.querySelector('#style-live-size');
                if (sizeSpan) sizeSpan.textContent = `${Math.round(el.offsetWidth)} × ${Math.round(el.offsetHeight)}`;
                const input = stylePanel.querySelector(`.style-input[data-prop="${prop}"]`);
                if (input) {
                    const edited = !!el.style.getPropertyValue(prop);
                    input.style.background = edited ? '#0f2b1e' : '#0f172a';
                    input.style.color = edited ? '#34d399' : '#fbbf24';
                    input.style.borderColor = edited ? '#10b981' : '#4b5563';
                }
                // 🔑 手动输入后同步枚举下拉框（不在枚举里则显示"自定义…"）
                const enumSel = stylePanel.querySelector(`.style-enum[data-prop="${prop}"]`);
                if (enumSel) {
                    const cur = el.style.getPropertyValue(prop).trim();
                    const has = [...enumSel.options].some(o => o.value === cur);
                    enumSel.value = has ? cur : '';
                };
				                // 🔑 同步属性行标签的复制内容为实时值
                const label = stylePanel.querySelector(`.style-label[data-prop="${prop}"]`);
                if (label) {
                    let cur = el.style.getPropertyValue(prop).trim();
                    if (!cur) {
                        try { cur = getComputedStyle(el).getPropertyValue(prop).trim(); } catch (e) { cur = ''; }
                    }
                    label.setAttribute('onclick', buildCopyOnClick(`${prop}: ${cur};`));
                }


            };

            // 文本输入：每敲一个字符立即生效
            stylePanel.querySelectorAll('.style-input').forEach(input => {
                const prop = input.dataset.prop;
                input.addEventListener('input', (ev) => {
                    ev.stopPropagation();
                    applyChange(prop, normalizeStyleValue(prop, input.value.trim()));
                });
                input.addEventListener('pointerdown', ev => ev.stopPropagation());
                input.addEventListener('click', ev => ev.stopPropagation());
            });

            // 🔑 枚举下拉框：选中即生效
            stylePanel.querySelectorAll('.style-enum').forEach(sel => {
                const prop = sel.dataset.prop;
                sel.addEventListener('change', (ev) => {
                    ev.stopPropagation();
                    if (sel.value === '') {
                        const input = stylePanel.querySelector(`.style-input[data-prop="${prop}"]`);
                        if (input) input.focus(); // 选"自定义…"则聚焦文本框
                        return;
                    }
                    const input = stylePanel.querySelector(`.style-input[data-prop="${prop}"]`);
                    if (input) input.value = sel.value;
                    applyChange(prop, sel.value);
                });
                sel.addEventListener('pointerdown', ev => ev.stopPropagation());
            });

            // 取色器
            stylePanel.querySelectorAll('.style-color').forEach(cinput => {
                const prop = cinput.dataset.prop;
                cinput.addEventListener('input', (ev) => {
                    ev.stopPropagation();
                    applyChange(prop, cinput.value);
                    const t = stylePanel.querySelector(`.style-input[data-prop="${prop}"]`);
                    if (t) t.value = cinput.value;
                });
                cinput.addEventListener('pointerdown', ev => ev.stopPropagation());
            });

            // 🔑 字体下拉框
            const fontSel = stylePanel.querySelector('.font-select');
            if (fontSel) {
                fontSel.addEventListener('change', (ev) => {
                    ev.stopPropagation();
                    if (!fontSel.value) return;
                    const v = `'${fontSel.value}'`; // 带引号，兼容含空格的字体名
                    const input = stylePanel.querySelector('.style-input[data-prop="font-family"]');
                    if (input) input.value = v;
                    applyChange('font-family', v);
                });
                fontSel.addEventListener('pointerdown', ev => ev.stopPropagation());
            }

            // 🔑 🌐 扫描本机字体
            const scanBtn = stylePanel.querySelector('.font-scan');
            if (scanBtn) scanBtn.onclick = (ev) => {
                ev.stopPropagation();
                scanLocalFonts(stylePanel, el);
            };

            // 🔑 📂 导入本地字体文件
            const fileInput = stylePanel.querySelector('.font-file');
            const importBtn = stylePanel.querySelector('.font-import');
            if (importBtn) importBtn.onclick = (ev) => {
                ev.stopPropagation();
                if (fileInput) fileInput.click();
            };
            if (fileInput) fileInput.addEventListener('change', (ev) => {
                ev.stopPropagation();
                importFontFile(fileInput.files[0], stylePanel, el);
                fileInput.value = '';
            });

            // 重置按钮
            const resetBtn = stylePanel.querySelector('#style-reset');
            if (resetBtn) resetBtn.onclick = (ev) => {
                ev.stopPropagation();
                resetElementStyles(el);
            };
        }
    }, 10);

    positionTooltip(mouseX, mouseY);
}

function positionTooltip(mouseX, mouseY) {
    if (!tooltip) return;
    tooltip.style.display = 'block';

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    tooltip.style.visibility = 'hidden';
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    tooltip.style.visibility = 'visible';

    let left = mouseX + 15;
    let top = mouseY + 15;

    if (left + width > vw) left = mouseX - width - 15;
    if (top + height > vh) top = mouseY - height - 15;

    left = Math.max(10, Math.min(left, vw - width - 10));
    top = Math.max(10, Math.min(top, vh - height - 10));

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    lastViewportWidth = vw;
    lastViewportHeight = vh;
}

// ==================== 拖拽实现（Pointer Events） ====================
function startDrag(e) {
    if (e.button !== 0) return;
    e.preventDefault();

    isDragging = true;
    dragPointerId = e.pointerId;
    const rect = tooltip.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;

    try { e.target.setPointerCapture(dragPointerId); } catch (err) {}

    window.rawAdd.call(document, 'pointermove', onDrag, true);
    window.rawAdd.call(document, 'pointerup', stopDrag, true);
    window.rawAdd.call(document, 'pointercancel', stopDrag, true);
    e.stopPropagation();
}

function onDrag(e) {
    if (!isDragging || e.pointerId !== dragPointerId) return;
    e.preventDefault();
    let left = e.clientX - dragOffsetX;
    let top = e.clientY - dragOffsetY;

    left = Math.max(0, Math.min(left, window.innerWidth - tooltip.offsetWidth));
    top = Math.max(0, Math.min(top, window.innerHeight - tooltip.offsetHeight));

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function stopDrag(e) {
    if (isDragging && e && e.pointerId === dragPointerId) {
        try { e.target.releasePointerCapture?.(dragPointerId); } catch (err) {}
    }
    isDragging = false;
    dragPointerId = null;
    window.rawRemove.call(document, 'pointermove', onDrag, true);
    window.rawRemove.call(document, 'pointerup', stopDrag, true);
    window.rawRemove.call(document, 'pointercancel', stopDrag, true);
    ensureTooltipInViewport();
}

function handleResize() {
    if (lastViewportWidth !== window.innerWidth ||
        lastViewportHeight !== window.innerHeight) {
        lastViewportWidth = window.innerWidth;
        lastViewportHeight = window.innerHeight;
        if (tooltip.style.display === 'block') ensureTooltipInViewport();
    }
    handleScrollResize();
}

function ensureTooltipInViewport() {
    if (!tooltip || tooltip.style.display !== 'block') return;
    const rect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left;
    let top = rect.top;
    let changed = false;

    if (rect.right > vw) { left = vw - rect.width - 10; changed = true; }
    if (rect.bottom > vh) { top = vh - rect.height - 10; changed = true; }
    if (rect.left < 0) { left = 10; changed = true; }
    if (rect.top < 0) { top = 10; changed = true; }

    if (changed) {
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }
}

function handleScrollResize() {
    if (updateOverlayRaf) cancelAnimationFrame(updateOverlayRaf);
    updateOverlayRaf = requestAnimationFrame(() => {
        if (currentState === 'd' && lockedElement) {
            updateOverlay(lockedElement);
        }
    });
}

function updateOverlay(el) {
    if (!el) {
        overlay.style.display = 'none';
        return;
    }
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.borderColor = (currentState === 'd' && el === lockedElement) ? '#10b981' : '#3b82f6';
    overlay.style.backgroundColor = (currentState === 'd' && el === lockedElement) ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== 状态转换 ====================
function enterSelectMode() {
    if (currentState !== 'a') return;
    console.log('🎯 进入选择模式');
    currentState = 'b';
    window.__ELEMENT_PICKER_STATE = 'b';
    window.__ELEMENT_PICKER_ACTIVE = true;
    if (!overlay) createUI();
    tooltip.classList.add('mode-preview');
    window.rawAdd.call(document, 'pointermove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('wheel', handleWheel, { passive: false });
    updateExitButton();
    showNotification('选择模式 - 移动鼠标预览，点击或Numpad0锁定', 'info');
    let event = new CustomEvent('element-picker-state-change',
        { detail: { state: 'preview', source: 'enter' } });
    document.dispatchEvent(event);
}

function exitSelectMode() {
    if (currentState !== 'b') return;
    console.log('🚪 退出选择模式');
    currentState = 'a';
    window.__ELEMENT_PICKER_STATE = 'a';
    window.__ELEMENT_PICKER_ACTIVE = false;
    tooltip.classList.remove('mode-preview');
    window.rawRemove.call(document, 'pointermove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('wheel', handleWheel, { passive: false });

    previewElement = null;
    resetNavMemory(); // 🔑 [改动] 整个会话退出时清理记忆链
    overlay.style.display = 'none';
    tooltip.style.display = 'none';
    updateExitButton();

    let event = new CustomEvent('element-picker-state-change',
        { detail: { state: 'inactive', source: 'exit' } });
    document.dispatchEvent(event);
}

// ==================== 事件处理 ====================
function handleMouseMove(e) {
    if (e.isTrusted === false) return;
    if (currentState !== 'b') return;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    const element = deepElementFromPoint(e.clientX, e.clientY);
    if (!element) return;
    if (element === shadowHost) return;
    if (element === previewElement) return;

    previewPath = getFullPath(element);
    previewIndex = 0;
    previewElement = previewPath[previewIndex];

    resetNavMemory(); // 🔑 [改动] 光标移到别的元素 y 时清空旧的 j-k-p 记忆链

    updateOverlay(previewElement);
    updateTooltip(previewElement, previewIndex, previewPath.length, e.clientX, e.clientY, false);
}

function handleWheel(e) {
    if (e.isTrusted === false) return;
    if (currentState !== 'b' || !previewElement) return;

    if (e.deltaY < 0) {
        if (previewIndex < previewPath.length - 1) {
            previewIndex++;
            // 🔑 [改动] 滚轮上翻也建立记忆：记住"翻上去之前在哪个孩子"
            navMemory.set(previewPath[previewIndex], previewPath[previewIndex - 1]);
            previewElement = previewPath[previewIndex];
        }
    } else {
        if (previewIndex > 0) {
            previewIndex--;
            previewElement = previewPath[previewIndex];
        }
    }
    updateOverlay(previewElement);
    updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
    e.preventDefault();
}

function handleClick(e) {
    if (e.isTrusted === false) return;
    const path = e.composedPath();
    if (path.includes(tooltip) || path.includes(exitButton)) {
        return;
    }

    if (currentState === 'd') {
        e.preventDefault();
        e.stopPropagation();
        showNotification('锁定状态，请按Numpad0解锁或ESC退出', 'info');
        return;
    }

    if (currentState === 'b' && previewElement) {
        e.preventDefault();
        e.stopPropagation();
        lockCurrentElement('mouse');
    }
}

function handleKeyDown(e) {
    if (!(currentState === 'b' || currentState === 'd')) {
        return;
    }
    if (e.isTrusted === false) return;

    // 🔑 [新增] 焦点在样式面板输入框/下拉框内时，只放行 ESC / `，其余不处理
    // （避免在输入框里打字触发 +/-///* 导航快捷键）
    const kdPath = e.composedPath ? e.composedPath() : [];
    if (kdPath.includes(tooltip) &&
        e.key !== 'Escape' && e.key !== '`' && e.key !== 'Backquote') {
        return;
    }

    if (e.key === 'Escape' || e.key === '`' || e.key === 'Backquote') {
        e.preventDefault();
        if (currentState === 'd') {
            unlockCurrentElement('keyboard');
        } else if (currentState === 'b') {
            exitSelectMode();
        }
        return;
    }

    if (e.code === 'Numpad0') {
        e.preventDefault();
        e.stopPropagation();
        if (currentState === 'b' && previewElement) {
            lockCurrentElement('keyboard');
        } else if (currentState === 'd') {
            unlockCurrentElement('keyboard');
        }
        return;
    }

    // 🔑 [改动] 锁定态 (d) 下：真正意义上的父子导航（带记忆）
    if (currentState === 'd' && lockedElement) {

        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            const parent = getNavParent(lockedElement);
            if (parent) {
                // 记忆：下次从 parent 按 "-" 应回到当前这里
                navMemory.set(parent, lockedElement);
                switchToLockedElement(parent);
            } else {
                showNotification('已在最顶层', 'info');
            }

        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            // 优先回"记忆中的孩子"，记忆失效或不存在则落到第一个子元素
            let target = navMemory.get(lockedElement);
            if (!(target && target.isConnected)) {
                target = getFirstNavChild(lockedElement);
            }
            if (target) {
                switchToLockedElement(target);
            } else {
                showNotification('当前元素没有子元素', 'info');
            }

        } else if (e.key === '/') {
            e.preventDefault();
            const prev = getPreviousSibling(lockedElement);
            if (prev) switchToLockedElement(prev);
            else showNotification('没有上一个同级元素', 'info');

        } else if (e.key === '*') {
            e.preventDefault();
            const next = getNextSibling(lockedElement);
            if (next) switchToLockedElement(next);
            else showNotification('没有下一个同级元素', 'info');

        } else if (e.code === 'Numpad9') {
            e.preventDefault();
            // 与 "-" 保持一致的语义：优先记忆，其次第一个孩子
            let target = navMemory.get(lockedElement);
            if (!(target && target.isConnected)) {
                target = getFirstNavChild(lockedElement);
            }
            if (target) switchToLockedElement(target);
            else showNotification('当前元素没有子元素', 'info');
        }
    }

    // 🔑 [改动] 预览态 (b) 下：同样使用带记忆的父子导航
    if (currentState === 'b' && previewElement) {

        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            const parent = getNavParent(previewElement);
            if (parent) {
                navMemory.set(parent, previewElement);
                switchToPreviewElement(parent);
            } else {
                showNotification('已在最顶层', 'info');
            }

        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            let target = navMemory.get(previewElement);
            if (!(target && target.isConnected)) {
                target = getFirstNavChild(previewElement);
            }
            if (target) {
                switchToPreviewElement(target);
            } else {
                showNotification('当前元素没有子元素', 'info');
            }

        } else if (e.key === '/') {
            e.preventDefault();
            const prev = getPreviousSibling(previewElement);
            if (prev) switchToPreviewElement(prev);
            else showNotification('没有上一个同级元素', 'info');

        } else if (e.key === '*') {
            e.preventDefault();
            const next = getNextSibling(previewElement);
            if (next) switchToPreviewElement(next);
            else showNotification('没有下一个同级元素', 'info');
        }
    }
}

function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : '#3b82f6'};
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 12px;
        z-index: 2147483647;
        animation: slideIn 0.3s;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        pointer-events: none;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2000);
}

// ==================== 键盘监听 ====================
document.addEventListener('keydown', handleKeyDown, true);

// ==================== 消息监听 ====================
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "ACTIVATE_PICKER") {
        if (currentState === 'a') {
            enterSelectMode();
        } else if (currentState === 'd') {
            unlockCurrentElement('extension');
        } else if (currentState === 'b') {
            exitSelectMode();
        }
    } else if (request.action === "UNSELECT") {
        handleExit();
    }
});

// 清理资源
window.addEventListener('beforeunload', () => {
    if (updateOverlayRaf) cancelAnimationFrame(updateOverlayRaf);
    document.removeEventListener('keydown', handleKeyDown, true);
});

// 初始化
createUI();
console.log('✅ 元素选择器已加载', performance.now());
