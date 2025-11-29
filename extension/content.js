// HubGuard Content Script
// Injects verification buttons into WhatsApp/Telegram Web

console.log("🛡️ HubGuard Sentinel Active");

// Helper to create the verify button
function createVerifyButton(text) {
    const btn = document.createElement('button');
    btn.innerHTML = "🛡️ Verify";
    btn.className = "hubguard-verify-btn";
    btn.title = "Verify with HubGuard";

    btn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();

        btn.innerHTML = "⏳ Checking...";
        btn.disabled = true;

        try {
            const response = await fetch('http://localhost:5000/api/verify-claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text })
            });

            const data = await response.json();

            if (data.status === 'success') {
                showResult(btn, data.verdict);
            } else {
                btn.innerHTML = "❌ Error";
                setTimeout(() => btn.innerHTML = "🛡️ Verify", 2000);
                btn.disabled = false;
            }
        } catch (err) {
            console.error("HubGuard Error:", err);
            btn.innerHTML = "❌ Offline";
            setTimeout(() => btn.innerHTML = "🛡️ Verify", 2000);
            btn.disabled = false;
        }
    };

    return btn;
}

function showResult(targetBtn, verdict) {
    // Create a tooltip/popup with the result
    const resultDiv = document.createElement('div');
    resultDiv.className = "hubguard-result-popup";

    // Color code based on verdict
    if (verdict.includes("HOAX")) {
        resultDiv.style.borderLeft = "4px solid #dc3545"; // Red
        targetBtn.innerHTML = "🚨 HOAX";
        targetBtn.style.backgroundColor = "#dc3545";
    } else if (verdict.includes("VERIFIED")) {
        resultDiv.style.borderLeft = "4px solid #28a745"; // Green
        targetBtn.innerHTML = "✅ VERIFIED";
        targetBtn.style.backgroundColor = "#28a745";
    } else {
        resultDiv.style.borderLeft = "4px solid #ffc107"; // Yellow
        targetBtn.innerHTML = "ℹ️ UNCERTAIN";
        targetBtn.style.backgroundColor = "#ffc107";
        targetBtn.style.color = "#000";
    }

    resultDiv.innerText = verdict;

    // Add close button
    const close = document.createElement('span');
    close.innerHTML = " &times;";
    close.style.cursor = "pointer";
    close.style.float = "right";
    close.onclick = () => resultDiv.remove();
    resultDiv.prepend(close);

    targetBtn.parentNode.appendChild(resultDiv);
}

// Observer to watch for new messages
const observer = new MutationObserver((mutations) => {
    // WhatsApp Message Selector (may change over time, this is a common one)
    // Looking for message text bubbles
    const messages = document.querySelectorAll('.message-in .copyable-text span.selectable-text, .message-out .copyable-text span.selectable-text');

    messages.forEach(msg => {
        // Check if we already added a button
        if (msg.parentNode.querySelector('.hubguard-verify-btn')) return;

        // Only verify messages longer than 20 chars (avoid "hi", "hello")
        if (msg.innerText.length < 20) return;

        const btn = createVerifyButton(msg.innerText);
        msg.parentNode.appendChild(btn);
    });
});

// Start observing the chat window
// We observe document.body because WhatsApp is a SPA (Single Page App)
observer.observe(document.body, {
    childList: true,
    subtree: true
});
