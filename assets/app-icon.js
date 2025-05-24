// Icon helper module
const { nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Create basic blue square icon
function createBasicIcon() {
    try {
        // Create simple SVG icon with darker colors
        const iconData = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <rect width="16" height="16" fill="#2E3440" rx="3" />
        <rect x="3" y="3" width="10" height="2" fill="#81A1C1" />
        <rect x="3" y="7" width="10" height="2" fill="#81A1C1" />
        <rect x="3" y="11" width="10" height="2" fill="#81A1C1" />
      </svg>
    `;

        // Convert to Base64 data URL
        const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconData).toString('base64');

        // Create icon using Electron's nativeImage
        return nativeImage.createFromDataURL(dataUrl);
    } catch (error) {
        console.error('Failed to create icon:', error);
        return nativeImage.createEmpty();
    }
}

// Export functions
module.exports = {
    createBasicIcon,
}; 