const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "vibelist.log");

function log(label, data) {
    const timestamp = new Date().toISOString();
    const entry = `\n[${timestamp}] ${label}\n${JSON.stringify(data, null, 2)}\n${"─".repeat(80)}`;
    
    // Log to console
    console.log(`[${label}]`, JSON.stringify(data, null, 2));
    
    // Log to file
    fs.appendFileSync(LOG_FILE, entry);
}

function clearLog() {
    fs.writeFileSync(LOG_FILE, "");
}

module.exports = { log, clearLog };
