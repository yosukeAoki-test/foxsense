console.log('Devices.js loaded - checking DOM state:', document.readyState);

// CSP対応：全ての関数をイベントリスナーで処理
function toggleAddDeviceForm() {
    console.log('✓ toggleAddDeviceForm called at:', new Date().toISOString());
    
    const form = document.getElementById('addDeviceForm');
    console.log('✓ Form search result:', form);
    
    if (form) {
        const currentDisplay = window.getComputedStyle(form).display;
        console.log('✓ Current display style:', currentDisplay);
        
        if (form.style.display === 'none' || form.style.display === '' || currentDisplay === 'none') {
            form.style.display = 'block';
            console.log('✓ Form shown');
            
            // フォーカスをSigfox IDフィールドに設定
            const sigfoxInput = document.getElementById('sigfox_id');
            if (sigfoxInput) {
                setTimeout(() => sigfoxInput.focus(), 100);
                console.log('✓ Focus set to sigfox input');
            }
        } else {
            form.style.display = 'none';
            console.log('✓ Form hidden');
        }
    } else {
        console.error('❌ Form element with ID "addDeviceForm" not found!');
        console.log('Available elements with IDs:', 
            Array.from(document.querySelectorAll('[id]')).map(el => el.id));
    }
}

function hideAddDeviceForm() {
    console.log('✓ hideAddDeviceForm called');
    const form = document.getElementById('addDeviceForm');
    if (form) {
        form.style.display = 'none';
        const formElement = form.querySelector('form');
        if (formElement) {
            formElement.reset();
        }
        console.log('✓ Form hidden and reset');
    }
}

// ページ読み込み完了時に実行
function initializeDevicesPage() {
    console.log('✓ Devices page initialization started');
    
    // デバイス追加ボタンの処理
    const addButton = document.querySelector('[data-action="toggle-add-form"]');
    if (addButton) {
        addButton.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('✓ Add device button clicked');
            toggleAddDeviceForm();
        });
        console.log('✓ Add device button event listener added');
    } else {
        console.error('❌ Add device button not found');
    }
    
    // キャンセルボタンの処理
    const cancelButton = document.querySelector('[data-action="hide-add-form"]');
    if (cancelButton) {
        cancelButton.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('✓ Cancel button clicked');
            hideAddDeviceForm();
        });
        console.log('✓ Cancel button event listener added');
    }
    
    // Sigfox IDを大文字に変換
    const sigfoxInput = document.getElementById('sigfox_id');
    if (sigfoxInput) {
        sigfoxInput.addEventListener('input', function(e) {
            e.target.value = e.target.value.toUpperCase();
        });
        console.log('✓ Sigfox input event listener added');
    }
    
    console.log('✓ Devices page initialization completed');
}

// 初期化実行
if (document.readyState === 'loading') {
    console.log('✓ DOM loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initializeDevicesPage);
} else {
    console.log('✓ DOM ready, initializing immediately');
    initializeDevicesPage();
}

console.log('✓ Devices.js setup completed');