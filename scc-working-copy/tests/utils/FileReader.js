const fs = require('fs');
class FileReader {
    constructor(filepath) {
        this.filepath = filepath;
    }
    getFileContents() {
        const raw = fs.readFileSync(this.filepath, 'utf-8');
        const asns = raw.split(/[\r\n]+/).map(a => a.trim()).filter(Boolean).join(',');
        console.log("Processing ASNS - " + asns);
        return asns;
    }
}
module.exports = { FileReader };