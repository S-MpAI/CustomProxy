const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs'); 
const os = require('os'); 
const cheerio = require('cheerio');
const ip = require('ip');
const { URL } = require('url');
const API_KEY = 'your-secret-api-key'; 
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { Transform } = require('stream');
const AllFunctionsClass = require('./functions');
const allFunctions = new AllFunctionsClass();


const isValidUrl = (url) => {
    try {
        const parsedUrl = new URL(url);
        const isHttpOrHttps = ['http:', 'https:'].includes(parsedUrl.protocol);
        const isNotLocalhost = parsedUrl.hostname !== 'localhost';
        return isHttpOrHttps && isNotLocalhost;
    } catch {
        return false;
    }
};

async function configurePage(page, url, size) {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': url,
        'Connection': 'keep-alive',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-User': '?1',
        'Sec-Fetch-Dest': 'document',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
    });

    await page.setDefaultNavigationTimeout(120000);
    await page.setDefaultTimeout(120000);

    if (size) {
        const [width, height] = size.split('x').map(Number);
        if (!isNaN(width) && !isNaN(height)) {
            await page.setViewport({ width, height });
        } else {
            throw new Error('Invalid size parameter format');
        }
    }

    const cookies = [
        { name: 'example_cookie', value: 'cookie_value', domain: new URL(url).hostname },
        { name: 'preferred_color_mode', value: 'dark', domain: new URL(url).hostname },
        { name: 'gw', value: 'seen', domain: new URL(url).hostname },
    ];
    await page.setCookie(...cookies);

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(window, 'matchMedia', {
            value: (query) => ({
                matches: query === '(prefers-color-scheme: dark)',
                addListener: () => {},
                removeListener: () => {},
            }),
        });
    });
}

function isStreamableContent(reqHeaders) {
    return reqHeaders.startsWith('video/') || reqHeaders.startsWith('application/octet-stream');
}

async function handleStreamableContent(res, fullUrl) {
    try {
        const response = await axios({
            method: 'get',
            url: fullUrl,
            responseType: 'stream',
        });

        const contentType = response.headers['content-type'];
        let fileName = response.headers['content-disposition']?.match(/filename="([^"]*)"/)?.[1];
        fileName = sanitizeFileName(fileName);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        response.data.pipe(res);
        response.data.on('end', () => res.end());
        response.data.on('error', (err) => {
            res.status(500).send({
                status: 'error',
                message: 'Failed to stream the file',
                error: err.message,
            });
        });
    } catch (error) {
        console.error('Error while downloading the file:', error);
        res.status(500).send({
            status: 'error',
            message: 'Failed to download the file from the URL',
            error: error.message,
        });
    }
}

async function handleHtmlContent(page, res, fullUrl, baseUrl) {
    try {
        const response = await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 120000 });
        const html = await processHtmlContent(page, baseUrl);

        const contentType = response.headers()['content-type'] || 'text/html; charset=utf-8';
        res.set('Content-Type', contentType);
        res.send(html);
    } catch (error) {
        throw error;
    }
}

async function processHtmlContent(page, baseUrl) {
    const html = await page.content();
    const $ = cheerio.load(html);

    $('a').each((_, element) => {
        const href = $(element).attr('href');
        if (href && !href.startsWith('#')) {
            $(element).attr('href', `/api/full_page?url=${encodeURIComponent(new URL(href, baseUrl).href)}`);
        }
    });

    $('img, script, link, video').each((_, element) => {
        const attr = $(element).is('link') ? 'href' : 'src';
        const val = $(element).attr(attr);
        if (val) {
            $(element).attr(attr, `/api/proxy_handler?url=${encodeURIComponent(new URL(val, baseUrl).href)}`);
        }
        if ($(element).is('img')) {
            const dataSrc = $(element).attr('data-src');
            if (dataSrc) {
                $(element).attr('data-src', `/api/proxy_handler?url=${encodeURIComponent(new URL(dataSrc, baseUrl).href)}`);
            }
        }
    });

    $('form').each((_, element) => {
        const action = $(element).attr('action');
        if (action) {
            $(element).attr('action', `/api/proxy_handler?url=${encodeURIComponent(new URL(action, baseUrl).href)}`);
        }
    });

    return $.html();
}

function sanitizeFileName(fileName) {
    if (!fileName) {
        throw new Error('Invalid file name detected');
    }
    fileName = fileName.replace(/\s+/g, '');
    const hasInvalidCharacters = /[<>:"/\\|?*]/.test(fileName) || [...fileName].some(char => char.charCodeAt(0) < 32);
    if (fileName.length > 255 || hasInvalidCharacters) {
        throw new Error('Invalid file name detected');
    }
    return fileName;
}

function handleError(res, error, url) {
    const errorMapping = {
        'ERR_BAD_REQUEST': 404,
        'TimeoutError': 500,
        'ERR_ABORTED': 500,
        'ERR_CONNECTION_REFUSED': 500,
        'ERR_TOO_MANY_REDIRECTS': 500,
    };

    const statusCode = errorMapping[error.code] || 500;
    res.status(statusCode).json({
        type: error.name || 'None',
        error: error.message,
        url,
    });
}

function buildFullUrl(url, params) {
    const queryParams = new URLSearchParams(params).toString();
    return queryParams ? `${url}?${queryParams}` : url;
}

async function getImageDimensions(fullUrl, width, height) {
    let imageWidth = parseInt(width, 10) || 1920;
    let imageHeight = parseInt(height, 10) || 1080;

    try {
        const response = await axios.head(fullUrl, { timeout: 5000 });
        const contentType = response.headers['content-type'];

        if (contentType && !contentType.startsWith('image/')) {
            imageWidth = parseInt(response.headers['width'], 10) || imageWidth;
            imageHeight = parseInt(response.headers['height'], 10) || imageHeight;
        }
    } catch (err) {
        console.warn('Failed to fetch headers:', err.message);
    }

    return { imageWidth, imageHeight };
}

function isValidDimensions(width, height) {
    return !isNaN(width) && !isNaN(height) && width > 0 && height > 0;
}

async function setUpPage(page, width, height) {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width, height });
}

async function loadPage(page, fullUrl) {
    try {
        await page.goto(fullUrl, { waitUntil: 'load', timeout: 60000 });
    } catch (err) {
        throw new Error(`Failed to load the URL: ${err.message}`);
    }
}

async function captureScreenshot(page, parsedUrl) {
    const cookies = [
        { name: 'example_cookie', value: 'cookie_value', domain: parsedUrl.hostname },
        { name: 'preferred_color_mode', value: 'dark', domain: parsedUrl.hostname }
    ];
    await page.setCookie(...cookies);

    const safeFileName = parsedUrl.hostname.replace(/[^a-zA-Z0-9]/g, '_');
    const screenshotPath = path.join(os.tmpdir(), `${safeFileName}.png`);

    try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (err) {
        throw new Error(`Failed to take a screenshot: ${err.message}`);
    }

    return screenshotPath;
}

async function sendScreenshot(res, screenshotPath) {
    res.sendFile(screenshotPath, async (err) => {
        if (err) {
            return res.status(500).send('Error sending the screenshot');
        }

        // Clean up after sending
        try {
            await fs.promises.unlink(screenshotPath);
        } catch (unlinkError) {
            console.error('Error removing file:', unlinkError);
        }
    });
}

async function handleCssResponse(response, url, req, res) {
    const proxyUrl = `${req.protocol}://${req.get('host')}/api/proxy_handler?url=`;
    const cssContent = await allFunctions.streamToString(response.data);
    const modifiedCss = allFunctions.replaceFontFaceUrls(cssContent, url, proxyUrl);
    res.set('Content-Type', 'text/css');
    res.send(modifiedCss);
}

function handleVideoResponse(response, res) {
    res.set('Content-Type', 'video/mp4');
    response.data.pipe(res);
}

function handleGenericResponse(response, contentType, res) {
    res.set('Content-Type', contentType);
    response.data.pipe(res);
}

function handleJavaScriptResponse(response, res, req) {
    const proxyPrefix = `${req.protocol}://${req.get('host')}/api/proxy_handler?url=`;

    const transformStream = new Transform({
        transform(chunk, encoding, callback) {
            let modifiedChunk = chunk.toString();
            modifiedChunk = modifiedChunk.replace(/fetch\s*\((['"])(https?:\/\/.*?)(['"])/g, (match, quote1, originalUrl, quote2) => {
                return `fetch(${quote1}${proxyPrefix}${encodeURIComponent(originalUrl)}${quote2}`;
            });

            callback(null, modifiedChunk);
        }
    });

    res.setHeader('Content-Type', 'application/javascript');
    response.data.pipe(transformStream).pipe(res);
}

function handleErrorResponse(error, req, res) {
    console.log({ type: error.code, error: error.message, url: req.query.url });

    const errorResponseMap = {
        TimeoutError: { status: 200, type: 'TimeoutError', message: error.message },
        ENOTFOUND: { status: 404, type: 'NotFound', message: error.message },
    };

    const matchedError = Object.keys(errorResponseMap).find(errType => error.name === errType || error.code === errType);

    if (matchedError) {
        const { status, type, message } = errorResponseMap[matchedError];
        return res.status(status).json({ type, error: message });
    }

    const errorMessages = [
        { keyword: 'net::ERR_ABORTED', type: 'ERR_ABORTED' },
        { keyword: 'ERR_CONNECTION_REFUSED', type: 'ERR_CONNECTION_REFUSED' },
        { keyword: 'ERR_TOO_MANY_REDIRECTS', type: 'ERR_TOO_MANY_REDIRECTS' },
    ];

    for (const { keyword, type } of errorMessages) {
        if (error.message.includes(keyword)) {
            return res.status(500).json({ type, error: error.message });
        }
    }

    res.status(200).json({ type: 'None', error: error.message });
}

async function collectRequestData(req) {
    return new Promise((resolve, reject) => {
        let data = Buffer.alloc(0);

        req.on('data', (chunk) => {
            data = Buffer.concat([data, chunk]);
        });

        req.on('end', () => resolve(data));
        req.on('error', (err) => reject(err));
    });
}

function handleContentResponse(contentType, externalApiResponse, url, req, res) {
    if (contentType.includes('text/css')) {
        const proxyUrl = `${req.protocol}://${req.get('host')}/api/proxy_handler?url=`;
        allFunctions.streamToString(externalApiResponse.data)
            .then((cssContent) => {
                const modifiedCss = allFunctions.replaceFontFaceUrls(cssContent, url, proxyUrl);
                res.set('Content-Type', 'text/css');
                res.send(modifiedCss);
            })
            .catch((err) => {
                console.error(`Error processing CSS: ${err.message}`);
                res.status(500).json({ error: 'Error processing CSS content.' });
            });
    } else if (contentType.includes('video/mp4')) {
        res.set('Content-Type', 'video/mp4');
        externalApiResponse.data.pipe(res);
    } else {
        if (externalApiResponse.data.pipe && typeof externalApiResponse.data.pipe === 'function') {
            externalApiResponse.data.pipe(res);
        } else {
            res.set('Content-Type', contentType);
            res.send(externalApiResponse.data);
        }
    }
}

// Helper function to handle errors
function handleError(error, res, url) {
    console.error(`Stack trace: ${error.stack}`);
    console.error({ type: error.code, error: error.message, url });

    if (error.response) {
        res.status(error.response.status).json({
            error: error.response.data || error.message,
        });
    } else {
        res.status(500).json({ error: error.message });
    }
}


class Routes {
    constructor(browser, rootSite) {
        this.browser = browser;
        this.rootSite = rootSite;
    }

    async screenshot(req, res) {
        const { url, width, height, ...params } = req.query;

        if (!url) return res.status(400).send('Url parameter is required');
    
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                return res.status(400).send('Invalid URL protocol. Only HTTP and HTTPS are allowed.');
            }
        } catch (err) {
            return res.status(400).send('Malformed URL.');
        }
    
        const fullUrl = buildFullUrl(url, params);
        const { imageWidth, imageHeight } = await getImageDimensions(fullUrl, width, height);
    
        if (!isValidDimensions(imageWidth, imageHeight)) {
            return res.status(400).send('Invalid image dimensions.');
        }
    
        const page = await this.browser.newPage();
        await setUpPage(page, imageWidth, imageHeight);
    
        try {
            await loadPage(page, fullUrl);
            const screenshotPath = await captureScreenshot(page, parsedUrl);
            await sendScreenshot(res, screenshotPath);
        } catch (err) {
            console.error('Error:', err);
            console.error(`Stack trace: ${err.stack}`);
            return res.status(500).json({ type: err.name || 'UnknownError', error: err.message || 'An unknown error occurred.' });
        } finally {
            await page.close();
        }
    }

    async full_page(req, res) {
        const { url, size, ...params } = req.query;
        if (!url) {
            return res.status(400).send('Url parameter is required');
        }
        if (!isValidUrl(url)) {
            return res.status(403).send('Url parameter is forbidden.');
        }

        const queryParams = new URLSearchParams(params).toString();
        const fullUrl = queryParams ? `${url}&${queryParams}` : url;

        const page = await this.browser.newPage();
        try {
            await configurePage(page, url, size);

            const reqHeaders = await allFunctions.getContentType(this.rootSite, fullUrl);
            if (isStreamableContent(reqHeaders)) {
                return await handleStreamableContent(res, fullUrl);
            } else {
                return await handleHtmlContent(page, res, fullUrl, url);
            }
        } catch (err) {
            console.error('Error:', err);
            console.error(`Stack trace: ${err.stack}`);
            return handleError(err, res, req.query.url);
        } finally {
            try {
                await page.close();
            } catch (closeError) {
                console.error('Error closing page:', closeError);
            }
        }
    }

    async proxy_handler_get(req, res) {
        const url = req.query.url;
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        console.log(`[Routes][proxy_handler_get] ${clientIp}`);

        if (!url) {
            let code = { error: 'Url parameter is required' }
            console.log(`[Routes][proxy_handler_get] ${clientIp} -> ${code}`);
            return res.status(400).json(code);
        }
    
        if (!allFunctions.isValidUrl(url)) {
            return res.status(403).json({ error: `Url parameter is forbidden.` });
        }
    
        try {
            const response = await axios({ method: 'get', url, responseType: 'stream' });
    
            if (response.status !== 200) {
                return res.status(response.status).json({
                    error: `Received status code ${response.status}`,
                    serverResponse: response.data
                });
            }
    
            const contentType = response.headers['content-type'] || 'application/octet-stream';
    
            if (contentType.includes('text/css')) {
                await handleCssResponse(response, url, req, res);
            } else if (contentType.includes('video/mp4')) {
                handleVideoResponse(response, res);
            } else if (contentType.includes('application/javascript') || contentType.includes('text/javascript')) {
                handleJavaScriptResponse(response, res, req);
            } else {
                handleGenericResponse(response, contentType, res);
            }
    
        } catch (err) {
            console.error('Error:', err);
            console.error(`Stack trace: ${err.stack}`);
            handleErrorResponse(err, req, res);
        }
    }

    async proxy_handler_post(req, res) {
        const url = req.query.url;
        if (!url) {
            return res.status(400).json({ error: 'Url parameter is required' });
        }
    
        if (!allFunctions.isValidUrl(url)) {
            return res.status(403).json({ error: 'Url parameter is forbidden.' });
        }
    
        let data = await collectRequestData(req);
    
        try {
            const externalApiResponse = await axios({
                method: 'post',
                url: url,
                data: data,
                headers: {},
            });
    
            if (externalApiResponse.status !== 200) {
                return res.status(externalApiResponse.status).json({
                    error: `Received status code ${externalApiResponse.status}`,
                    serverResponse: externalApiResponse.data,
                });
            }
    
            const contentType = externalApiResponse.headers['content-type'] || 'application/octet-stream';
            console.log(`Content-Type [POST]: ${contentType}`);
    
            handleContentResponse(contentType, externalApiResponse, url, req, res);
        } catch (err) {
            console.error('Error:', err);
            console.error(`Stack trace: ${err.stack}`);
            handleError(err, res, url);
        }
    }
}

module.exports = Routes;
