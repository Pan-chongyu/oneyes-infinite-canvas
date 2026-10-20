import axios from "axios";
// Axios XHR rejects custom schemes before Electron can handle the request.
// Fetch reaches our same-origin protocol handler without disabling WebSecurity.
export function initializeDesktopTransport() {
    if (window.oneYesDesktop) axios.defaults.adapter = "fetch";
}
