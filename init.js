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
app.use(express.json());
app.disable('x-powered-by');

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

    const replaceFontFaceUrls = (cssContent, baseUrl, proxyUrl) => {
        return cssContent.replace(/url\(['"]?(.*?)['"]?\)/g, (match, originalUrl) => {
            const absoluteUrl = new URL(originalUrl, baseUrl).href; // Преобразование относительного пути в абсолютный
            const proxiedUrl = `${proxyUrl}${encodeURIComponent(absoluteUrl)}`;
            return `url('${proxiedUrl}')`;
        });
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
        const { url, width, height, ...params } = req.query;

        // Validate URL
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

        const queryParams = new URLSearchParams(params).toString();
        const fullUrl = queryParams ? `${url}?${queryParams}` : url;

        // Default image dimensions
        let imageWidth = parseInt(width, 10) || 1920;
        let imageHeight = parseInt(height, 10) || 1080;

        try {
            // Fetch headers to get additional details if available
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

            // Validate dimensions
            if (isNaN(imageWidth) || isNaN(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
                return res.status(400).send('Invalid image dimensions.');
            }

            // Initialize Puppeteer for screenshot
            const browser = app.locals.browser;
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
            await page.setViewport({ width: imageWidth, height: imageHeight });

            try {
                await page.goto(fullUrl, { waitUntil: 'load', timeout: 60000 });
            } catch (err) {
                await page.close();
                return res.status(500).send(`Failed to load the URL: ${err.message}`);
            }

            // Set cookies if necessary
            const cookies = [
                { name: 'example_cookie', value: 'cookie_value', domain: parsedUrl.hostname },
                { name: 'preferred_color_mode', value: 'dark', domain: parsedUrl.hostname }
            ];
            await page.setCookie(...cookies);

            // Save screenshot
            const safeFileName = parsedUrl.hostname.replace(/[^a-zA-Z0-9]/g, '_');
            const screenshotPath = path.join(os.tmpdir(), `${safeFileName}.png`);

            try {
                await page.screenshot({ path: screenshotPath, fullPage: true });
            } catch (err) {
                await page.close();
                return res.status(500).send(`Failed to take a screenshot: ${err.message}`);
            }

            await page.close();

            // Send the screenshot
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

        } catch (error) {
            console.error('Error:', error);
            return res.status(500).json({ type: error.name || 'UnknownError', error: error.message || 'An unknown error occurred.' });
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
                {name: 'preferred_color_mode', value: 'dark', domain: new URL(url).hostname},
                {name: 'gw', value: 'seen',  domain: new URL(url).hostname}
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
            console.log(reqHeaders);
            if (reqHeaders.startsWith('video/') || reqHeaders.startsWith('application/octet-stream')) {
                console.log('Request headers:', reqHeaders);
                try {
                    const response = await axios({ method: 'get',url: fullUrl, responseType: 'stream', });
                    res.setHeader('Content-Type', response.headers['content-type']);
                    let fileName = response.headers['content-disposition']?.match(/filename="([^"]*)"/)?.[1];
                    if (fileName) {
                        fileName = fileName.replace(/\s+/g, '');
                    }
                    const invalidFileNamePattern = /[<>:"/\\|?*\u0000-\u001F]/;
                    if (!fileName || fileName.length > 255 || invalidFileNamePattern.test(fileName)) {
                        throw new Error("Invalid file name detected");
                    }

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
                
                $('img, script, link, video').each((_, element) => {
                    const attr = $(element).is('link') ? 'href' : 'src';
                    const val = $(element).attr(attr);
                
                    if (val) {
                        $(element).attr(attr, `/api/proxy_handler?url=${encodeURIComponent(new URL(val, url).href)}`);
                    }
                
                    // Дополнительная обработка для data-src
                    if ($(element).is('img')) {
                        const dataSrc = $(element).attr('data-src');
                        if (dataSrc) {
                            $(element).attr('data-src', `/api/proxy_handler?url=${encodeURIComponent(new URL(dataSrc, url).href)}`);
                        }
                    }
                });
                $('div').each((_, element) => {
                    const dataLink = $(element).attr('data-link');
                    if (dataLink) {
                        $(element).attr('data-link', `/api/proxy_handler?url=${encodeURIComponent(new URL(dataLink, url).href)}`);
                    }
                });

                $('form').each((_, element) => {
                    const action = $(element).attr('action');
                    if (action) {
                        $(element).attr('action', `/api/proxy_handler?url=${encodeURIComponent(new URL(action, url).href)}`);
                    }
                });

                $('section').each((_, element) => {
                    ['file-url', 'preview-url', 'large-url'].forEach(attr => {
                        const url = $(element).attr(`data-${attr}`);
                        if (url) {
                            if (attr === 'file-url') {
                                $(element).attr('action', `/api/proxy_handler?url=${encodeURIComponent(new URL(url, url).href)}`);
                            } else if (attr === 'preview-url') {
                                $(element).attr('data-preview-action', `/api/preview_handler?url=${encodeURIComponent(new URL(url, url).href)}`);
                            } else if (attr === 'large-url') {
                                $(element).css('background-image', `url(${url})`);
                            }
                        }
                    });
                });
                
                
                
                
                try {
                    const parsedContentType = contentType.split(';')[0];
                    if (!parsedContentType || !/^[a-z0-9-]+\/[a-z0-9-]+$/i.test(parsedContentType)) {throw new Error('Invalid Content-Type');}
                    res.set('Content-Type', contentType);
                } catch (error) {res.set('Content-Type', 'text/html; charset=utf-8');}
                res.send($.html());
        }
        } catch (error) {
            // console.log({ type: error.code, error: error.message, url: req.query.url });
            if (error.code === 'ERR_BAD_REQUEST') { return res.status(404).json({ type: error.name, error: error.message })
            } else if (error.name === 'TimeoutError') {return res.status(200).json({ type: error.name, error: error.message });
            } else if (error.message.includes('net::ERR_ABORTED')) {return res.status(200).json({ type: error.name, error: error.message });
            } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {return res.status(200).json({ type: error.name, error: error.message });
            } else if (error.message.includes('ERR_TOO_MANY_REDIRECTS')) {return res.status(200).json({ type: error.name, error: error.message });
            } else {return res.status(200).json({ type: "None", error: error.message });}
        } finally {
            try {await page.close();} 
            catch (closeError) {}
        }
    });

    app.get('/api/proxy_handler', async (req, res) => {
        // console.log(req.socket.remoteAddress);
        const url = req.query.url;
        if (!url) {
            return res.status(400).json({ error: 'Url parameter is required' });
        }
        if (!isValidUrl(url)) {
            return res.status(403).json({ error: `Url parameter is forbidden.` });
        }
    
        try {
            const response = await axios({
                method: 'get',
                url,
                responseType: 'stream', 
            });
    
            if (response.status !== 200) {
                return res.status(response.status).json({
                    error: `Received status code ${response.status}`,
                    serverResponse: response.data
                });
            }
    
            let contentType = response.headers['content-type'] || 'application/octet-stream';
            if (contentType.includes('text/css')) {
                const proxyUrl = `${req.protocol}://${req.get('host')}/api/proxy_handler?url=`;
                const cssContent = await streamToString(response.data); 
                const modifiedCss = replaceFontFaceUrls(cssContent, url, proxyUrl);
                contentType = 'text/css';
                res.set('Content-Type', contentType);
                res.send(modifiedCss);
            } 
            else if (contentType.includes('video/mp4')) {
                contentType = 'video/mp4'; 
                res.set('Content-Type', contentType);
                response.data.pipe(res); 
            } 
            else {
                res.set('Content-Type', contentType);
                response.data.pipe(res); 
            }
    
        } catch (error) {
            console.log({ type: error.code, error: error.message, url: req.query.url });
            if (error.name === 'TimeoutError') {
                return res.status(200).json({ type: "TimeoutError", error: error.message });
            } 
            else if (error.code === 'ENOTFOUND') {
                return res.status(404).json({ type: "NotFound", error: error.message });
            } else if (error.message.includes('net::ERR_ABORTED')) {
                return res.status(200).json({ type: "ERR_ABORTED", error: error.message });
            } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {
                return res.status(200).json({ type: "ERR_CONNECTION_REFUSED", error: error.message });
            } else if (error.message.includes('ERR_TOO_MANY_REDIRECTS')) {
                return res.status(200).json({ type: "ERR_TOO_MANY_REDIRECTS", error: error.message });
            } else {
                return res.status(200).json({ type: "None", error: error.message });
            }
        }
    });

    app.post('/api/proxy_handler', async (req, res) => {
        const url = req.query.url;
        let data = Buffer.alloc(0);
        if (!url) {
            return res.status(400).json({ error: 'Url parameter is required' });
        }
        if (!isValidUrl(url)) {
            return res.status(403).json({ error: 'Url parameter is forbidden.' });
        }
        req.on('data', chunk => {
            data = Buffer.concat([data, chunk]);
        });
    
        req.on('end', async () => {
            try {
                const externalApiResponse = await axios({
                    method: 'post',
                    url: url,
                    data: data,
                    headers: {
                    }
                });
        
                if (externalApiResponse.status !== 200) {
                    return res.status(externalApiResponse.status).json({
                        error: `Received status code ${externalApiResponse.status}`,
                        serverResponse: externalApiResponse.data
                    });
                }
        
                let contentType = externalApiResponse.headers['content-type'] || 'application/octet-stream';
                console.log(`Content-Type [POST]: ${contentType}`);
        
                // For CSS files, handle normally
                if (contentType.includes('text/css')) {
                    const proxyUrl = `${req.protocol}://${req.get('host')}/api/proxy_handler?url=`;
                    const cssContent = await streamToString(externalApiResponse.data); // Convert stream to text
                    const modifiedCss = replaceFontFaceUrls(cssContent, url, proxyUrl);
                    res.set('Content-Type', 'text/css');
                    res.send(modifiedCss);
                } 
                else if (contentType.includes('video/mp4')) {
                    res.set('Content-Type', 'video/mp4');
                    externalApiResponse.data.pipe(res); 
                } 
                else {
                    if (externalApiResponse.data.pipe && typeof externalApiResponse.data.pipe === 'function') {
                        externalApiResponse.data.pipe(res); 
                    } else {
                        res.set('Content-Type', contentType);
                        res.send(externalApiResponse.data);
                    }
                }
            } catch (error) {
                console.error({ type: error.code, error: error.message, url: req.query.url });
                if (error.response) {
                    res.status(error.response.status).json({
                        error: error.response.data || error.message
                    });
                } else {
                    res.status(500).json({ error: error.message });
                }
            }
        });
        
    });
    
    async function streamToString(stream) {
        const chunks = [];
        return new Promise((resolve, reject) => {
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            stream.on('error', reject);
        });
    }
    

    app.get('/api/pdf', async (req, res) => {
        const { url, size, ...params } = req.query;
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
