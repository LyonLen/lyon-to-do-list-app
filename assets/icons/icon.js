// 生成用于系统托盘的图标数据
const fs = require('fs');
const path = require('path');

// 简单的图标数据生成函数
function generateIconData() {
    const iconData = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" fill="#4C8BF5" rx="12" />
      <rect x="12" y="16" width="40" height="8" fill="white" rx="2" />
      <rect x="12" y="28" width="40" height="8" fill="white" rx="2" />
      <rect x="12" y="40" width="40" height="8" fill="white" rx="2" />
    </svg>
  `;

    // 将SVG转换为Base64
    const base64Data = Buffer.from(iconData).toString('base64');

    // 写入磁盘文件以便程序调用
    fs.writeFileSync(
        path.join(__dirname, 'icon.txt'),
        `data:image/svg+xml;base64,${base64Data}`
    );

    return `data:image/svg+xml;base64,${base64Data}`;
}

// 立即生成并导出
const iconDataUrl = generateIconData();
module.exports = { iconDataUrl }; 