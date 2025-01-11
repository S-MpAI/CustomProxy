const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs'); 
const os = require('os'); 
const cheerio = require('cheerio');
const app = express();
const ip = require('ip');
const { URL } = require('url');

const API_KEY = 'your-secret-api-key'; 
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());


(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });   
    app.locals.browser = browser;
    const rootSite = 'http://localhost:4000'

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
    

    async function getContentType(rootSite, fullUrl) {
        console.log(rootSite, fullUrl);
        if (!rootSite || !fullUrl) {throw new Error("Both 'rootSite' and 'fullUrl' parameters are required.");}
        try {
            const proxyUrl = `${rootSite}/api/proxy_handler?url=${encodeURIComponent(fullUrl)}`;
            const response = await axios.get(proxyUrl, {responseType: 'arraybuffer',headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36','Accept-Language': 'en-US,en;q=0.9','Referer': fullUrl,'Connection': 'keep-alive','Sec-Fetch-Site': 'same-origin','Sec-Fetch-Mode': 'navigate','Sec-Fetch-User': '?1','Sec-Fetch-Dest': 'document','Cache-Control': 'no-cache','Upgrade-Insecure-Requests': '1',},});
            const contentType = response.headers['content-type'];
            if (!contentType) {throw new Error("Content-Type header is missing in the response.");}
            return contentType;
        } catch (error) {return 'text/html; charset=utf-8';}
    }


    app.get('/api/screenshot', async (req, res) => {
        const { url, size, ...params } = req.query;
        
        // Validate URL
        if (!url) return res.status(400).send('Url parameter is required');
        if (!isValidUrl(url)) return res.status(403).send(`Url parameter is forbidden.`);
        
        const queryParams = new URLSearchParams(params).toString();
        const fullUrl = queryParams ? `${url}&${queryParams}` : url;
    
        // Default image dimensions
        let imageWidth = 1920;
        let imageHeight = 1080;
    
        try {
            // Fetch headers to get content type and dimensions (if possible)
            try {
                const response = await axios.head(fullUrl);
                const contentType = response.headers['content-type'];
    
                // If not an image, attempt to fetch dimensions
                if (!contentType.startsWith('image/')) {
                    imageWidth = parseInt(response.headers['width'], 10) || imageWidth;
                    imageHeight = parseInt(response.headers['height'], 10) || imageHeight;
                }
            } catch (err) {
                // Ignore error from axios.head()
            }
    
            // Override dimensions if passed in the query
            if (req.query.height) imageHeight = parseInt(req.query.height, 10) || imageHeight;
            if (req.query.width) imageWidth = parseInt(req.query.width, 10) || imageWidth;
    
            // Validate dimensions format
            const dimensions = req.query.url?.match(/(\d+)x(\d+)/) || null;
            const urlParam = req.query.url;
            if (urlParam && urlParam.length < 1000) {const dimensions = urlParam.match(/(\d+)\s*x\s*(\d+)/) || null;}
            else {res.status(400).send("URL character limit exceeded");}
            
            if (dimensions) {
                imageWidth = parseInt(dimensions[1], 10) || imageWidth;
                imageHeight = parseInt(dimensions[2], 10) || imageHeight;
            }
    
            // Validate final dimensions
            if (isNaN(imageWidth) || isNaN(imageHeight)) throw new Error('Invalid image dimensions');
    
            // Initialize browser page for screenshot
            const page = await app.locals.browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
            await page.setViewport({ width: imageWidth, height: imageHeight });
            await page.goto(fullUrl, { waitUntil: 'load', timeout: 60000 });
    
            // Set cookies
            const cookies = [
                { name: 'example_cookie', value: 'cookie_value', domain: new URL(url).hostname },
                { name: 'preferred_color_mode', value: 'dark', domain: new URL(url).hostname }
            ];
            await page.setCookie(...cookies);
    
            // Save screenshot
            const safeFileName = fullUrl.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
            const screenshotPath = path.join(os.tmpdir(), `${safeFileName}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
    
            // Send the screenshot
            res.sendFile(screenshotPath, async (err) => {
                if (err) {
                    return res.status(500).send('Error sending screenshot');
                }
    
                // Clean up after sending
                try {
                    await fs.promises.unlink(screenshotPath);
                } catch (unlinkError) {
                    console.error('Error removing file:', unlinkError);
                }
            });
    
        } catch (error) {
            // Handle different types of errors
            const errorType = error.name || 'None';
            const errorMessage = error.message || 'Unknown error';
    
            // Handle timeout and connection errors
            if (error.name === 'TimeoutError') return res.status(500).json({ type: errorType, error: errorMessage });
            if (errorMessage.includes('net::ERR_ABORTED')) return res.status(500).json({ type: 'ERR_ABORTED', error: errorMessage });
            if (errorMessage.includes('ERR_CONNECTION_REFUSED')) return res.status(500).json({ type: 'ERR_CONNECTION_REFUSED', error: errorMessage });
            if (errorMessage.includes('ERR_TOO_MANY_REDIRECTS')) return res.status(500).json({ type: 'ERR_TOO_MANY_REDIRECTS', error: errorMessage });
    
            // Default error response
            return res.status(500).json({ type: errorType, error: errorMessage });
        }
    });
    


    app.get('/api/full_page', async (req, res) => {
        const { url, size, ...params } = req.query;
        if (!url) {return res.status(400).send('Url parameter is required');}
        if (!isValidUrl(url))  {return res.status(403).send(`Url parameter is forbidden.`);}

        const queryParams = new URLSearchParams(params).toString();
        const fullUrl = queryParams ? `${url}&${queryParams}` : url;
        if (size) {
            const [width, height] = size.split('x').map(Number);
            if (!isNaN(width) && !isNaN(height)) {await page.setViewport({ width, height });} 
            else {return res.status(400).send('Invalid size parameter format');}
        }
        const page = await app.locals.browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({'Accept-Language': 'en-US,en;q=0.9','Referer': url,'Connection': 'keep-alive','Sec-Fetch-Site': 'same-origin','Sec-Fetch-Mode': 'navigate','Sec-Fetch-User': '?1','Sec-Fetch-Dest': 'document','Cache-Control': 'no-cache','Upgrade-Insecure-Requests': '1',});
            await page.setDefaultNavigationTimeout(120000);
            await page.setDefaultTimeout(120000);
            const cookies = [
                {name: 'example_cookie', value: 'cookie_value', domain: new URL(url).hostname },
                {name: 'preferred_color_mode', value: 'dark', domain: new URL(url).hostname }
            ];
            await page.setCookie(...cookies);
            await page.setRequestInterception(false);
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(window, 'matchMedia', {
                    value: (query) => ({
                        matches: query === '(prefers-color-scheme: dark)',
                        addListener: () => {},
                        removeListener: () => {},
                    }),
                });
            });
            let reqHeaders = await getContentType(rootSite, fullUrl);
            if (reqHeaders.startsWith('video/') || reqHeaders.startsWith('application/octet-stream')) {
                console.log('Request headers:', reqHeaders);
                try {
                    const response = await axios({ method: 'get',url: fullUrl, responseType: 'stream', });
                    const fileName = fullUrl.split('/').pop().replace(/\?.*$/, '');
                    res.setHeader('Content-Type', response.headers['content-type']);
                    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                    response.data.pipe(res);
                    response.data.on('end', () => {res.end();});
                    response.data.on('error', (err) => {res.status(500).send({status: 'error', message: 'Failed to stream the file', error: err.message});});
                } catch (error) {
                    console.error('Error while downloading the file:', error);
                    return res.status(500).send({status: 'error',message: 'Failed to download the file from the URL',error: error.message});
                }
            } else {
                let response = '';
                try {
                    response = await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 120000 });
                } catch (error) {
                    if (error.name === 'TimeoutError') {
                        return res.status(500).json({ type: "TimeoutError", error: 'Время для обработки страницы вышло.' });
                    } else if (error.message.includes('net::ERR_ABORTED')) {
                        try {
                            const response = await axios.get(`${rootSite}/api/proxy_handler?url=${fullUrl}`, {responseType: 'arraybuffer',headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36'}});
                            const contentType = response.headers['content-type'];
                            res.set('Content-Type', contentType);
                            res.send(response.data);
                        } catch (error) {
                        console.error( `${error.stack}\n${error.message}`)
                        return res.status(500).json({ type: "ERR_ABORTED", error: error.message }); 
                        }
                    } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {
                        return res.status(500).json({ type: "ERR_CONNECTION_REFUSED", error: error.message });
                    } else if (error.message.includes('ERR_TOO_MANY_REDIRECTS')) {
                        return res.status(500).json({ type: "ERR_TOO_MANY_REDIRECTS", error: error.message });
                    } else {
                        return res.status(500).json({ type: "None", error: error.message });
                    }
                }
                const contentType = req.headers['content-type'] || 'text/html; charset=utf-8';
                const html = await page.content();
                const $ = cheerio.load(html);

                $('a').each((_, element) => {
                    const href = $(element).attr('href');
                    if (href && !href.startsWith('#')) {
                        $(element).attr('href', `/api/full_page?url=${encodeURIComponent(new URL(href, url).href)}`);
                    }
                });
                $('img, script, link').each((_, element) => {
                    const attr = $(element).is('link') ? 'href' : 'src';
                    const val = $(element).attr(attr);
                    if (val) {
                        $(element).attr(attr, `/api/proxy_handler?url=${encodeURIComponent(new URL(val, url).href)}`);
                    }
                });
                try {
                    const parsedContentType = contentType.split(';')[0];
                    if (!parsedContentType || !/^[a-z0-9-]+\/[a-z0-9-]+$/i.test(parsedContentType)) {throw new Error('Invalid Content-Type');}
                    res.set('Content-Type', contentType);
                } catch (error) {res.set('Content-Type', 'text/html; charset=utf-8');}
                res.send($.html());
        }
        } catch (error) {
            if (error.name === 'TimeoutError') {return res.status(500).json({ type: "TimeoutError", error: error.message });
            } else if (error.message.includes('net::ERR_ABORTED')) {return res.status(500).json({ type: "ERR_ABORTED", error: error.message });
            } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {return res.status(500).json({ type: "ERR_CONNECTION_REFUSED", error: error.message });
            } else if (error.message.includes('ERR_TOO_MANY_REDIRECTS')) {return res.status(500).json({ type: "ERR_TOO_MANY_REDIRECTS", error: error.message });
            } else {return res.status(500).json({ type: "None", error: error.message });}
        } finally {
            try {await page.close();} 
            catch (closeError) {}
        }
    });
    

    app.get('/api/proxy_handler', async (req, res) => {
        const url = req.query.url;
        if (!url) {return res.status(400).json({ error: 'Url parameter is required' });}
        if (!isValidUrl(url)) {return res.status(403).json({ error: `Url parameter is forbidden.` });}

        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const contentType = response.headers['content-type'];
            res.set('Content-Type', contentType);
            res.send(response.data);
        } catch (error) {
            if (error.name === 'TimeoutError') {return res.status(500).json({ type: "TimeoutError", error: error.message });
            } else if (error.message.includes('net::ERR_ABORTED')) {return res.status(500).json({ type: "ERR_ABORTED", error: error.message });
            } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {return res.status(500).json({ type: "ERR_CONNECTION_REFUSED", error: error.message });
            } else if (error.message.includes('ERR_TOO_MANY_REDIRECTS')) {return res.status(500).json({ type: "ERR_TOO_MANY_REDIRECTS", error: error.message });
            } else {return res.status(500).json({ type: "None", error: error.message });}
        } finally {
            try {await page.close();} 
            catch (closeError) {}
        }
        
    });

    app.get('/api/pdf', async (req, res) => {
        const { url, html } = req.body;
        const page = await app.locals.browser.newPage();
        
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
            if (url) {
                await page.goto(url, { waitUntil: 'load' });
            } else if (html) {
                await page.setContent(html);
            } else {
                return res.status(400).json({ error: 'Either "url" or "html" parameter is required' });
            }
            const pdfBuffer = await page.pdf();
            res.set('Content-Type', 'application/pdf');
            res.send(pdfBuffer);
        } catch (error) {
            const errorTypes = {
                'TimeoutError': 'Request Timeout',
                'ERR_ABORTED': 'Request Aborted',
                'ERR_CONNECTION_REFUSED': 'Connection Refused',
                'ERR_TOO_MANY_REDIRECTS': 'Too Many Redirects'
            };
    
            const errorType = Object.keys(errorTypes).find(type => error.message.includes(type));
            if (errorType) {
                return res.status(500).json({ type: errorTypes[errorType], error: error.message });
            }
            return res.status(500).json({ type: 'Unknown Error', error: error.message });
        } finally {
            try {
                await page.close();
            } catch (closeError) {
                console.error('Error closing page:', closeError);
            }
        }
    });
    

    app.get('/api/html', async (req, res) => {
        const { url } = req.query;
        const page = await app.locals.browser.newPage();
        try{ 
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({'Accept-Language': 'en-US,en;q=0.9',});
            await page.goto(url, { waitUntil: 'load' });
            const html = await page.content();
            res.set('Content-Type', 'text/html');
            res.send(html);
        } catch (error) {
            if (error.name === 'TimeoutError') {return res.status(500).json({ type: "TimeoutError", error: error.message });
            } else if (error.message.includes('net::ERR_ABORTED')) {return res.status(500).json({ type: "ERR_ABORTED", error: error.message });
            } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {return res.status(500).json({ type: "ERR_CONNECTION_REFUSED", error: error.message });
            } else if (error.message.includes('ERR_TOO_MANY_REDIRECTS')) {return res.status(500).json({ type: "ERR_TOO_MANY_REDIRECTS", error: error.message });
            } else {return res.status(500).json({ type: "None", error: error.message });}
        } finally {
            try {await page.close();} 
            catch (closeError) {}
        }
    });

    app.set('trust proxy', true);
    app.listen(4000, () => {
        console.log('Сервер запущен на порту 4000');
    });
})();

