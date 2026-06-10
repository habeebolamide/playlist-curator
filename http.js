const axios = require("axios");

// Shared axios factory: sane timeout + credentials can never leak into error logs.
// Axios errors carry the full request config (including the Authorization header),
// so a plain console.error(err) would print secrets — redact them at the source.
function redactError(err) {
    if (err.config?.headers?.Authorization) {
        err.config.headers.Authorization = "[REDACTED]";
    }
    // The raw request object holds the full outgoing headers (and queued body
    // bytes) in Node internals — drop it entirely rather than chase every copy.
    delete err.request;
    if (err.response) delete err.response.request;
    return Promise.reject(err);
}

function createHttpClient(timeout = 10000) {
    const client = axios.create({ timeout });
    client.interceptors.response.use((res) => res, redactError);
    return client;
}

module.exports = { createHttpClient };
