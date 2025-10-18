// src/config.js

// Get the base URL for assets based on the current environment
export function getBaseUrl() {
    const pathPrefix = window.location.hostname === 'hadi-serhan.github.io' ? '/Project' : '';
    const scriptPath = document.currentScript?.src;
    if (scriptPath) {
        const url = new URL(scriptPath);
        return url.origin + pathPrefix;
    }
    return pathPrefix;
}
