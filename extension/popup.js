document.addEventListener('DOMContentLoaded', async () => {
    const statusDiv = document.getElementById('status');
    const checkBtn = document.getElementById('checkServer');

    async function checkConnection() {
        statusDiv.textContent = "Connecting to HubGuard Agent...";
        statusDiv.className = "status";

        try {
            const response = await fetch('http://localhost:5000/api/health');
            if (response.ok) {
                statusDiv.textContent = "✅ Connected to Agent";
                statusDiv.className = "status connected";
            } else {
                throw new Error('Server error');
            }
        } catch (error) {
            statusDiv.textContent = "❌ Agent Disconnected";
            statusDiv.className = "status disconnected";
        }
    }

    checkBtn.addEventListener('click', checkConnection);
    checkConnection();
});
