const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs'); 
const os = require('os'); 
const app = express();

const API_KEY = 'your-secret-api-key'; 

app.get('/api/screenshot', async (req, res) => {
    const { url, size, ...params } = req.query;

    if (!url) {
        return res.status(400).send('Url parameter is required');
    }

    const queryParams = new URLSearchParams(params).toString();
    const fullUrl = queryParams ? `${url}&${queryParams}` : url;

    let imageWidth = 1920;
    let imageHeight = 1080; 

    try {
        try {
            const response = await axios.head(fullUrl);
            const contentType = response.headers['content-type'];

            if (!contentType.startsWith('image/')) {
                imageWidth = parseInt(response.headers['width'], 10) || imageWidth;
                imageHeight = parseInt(response.headers['height'], 10) || imageHeight;
            }
        } catch {}

        if (req.query.height !== undefined) {
            imageHeight = parseInt(req.query.height, 10) || imageHeight;
        }
        if (req.query.width !== undefined) {
            imageWidth = parseInt(req.query.width, 10) || imageWidth;
        }

        if (true) {
            const dimensions = req.query.url.match(/(\d+)x(\d+)/);
            if (dimensions && dimensions.length === 3) {
                imageWidth = parseInt(dimensions[1], 10) || imageWidth;
                imageHeight = parseInt(dimensions[2], 10) || imageHeight;
            }
        }
        if (isNaN(imageWidth) || isNaN(imageHeight)) {
            throw new Error('Invalid image dimensions');
        }
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.setViewport({ width: imageWidth, height: imageHeight });
        await page.goto(fullUrl, { waitUntil: 'load', timeout: 60000 });
        const safeFileName = fullUrl.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100); 
        const screenshotPath = path.join(os.tmpdir(), `${safeFileName}.png`);

        await page.screenshot({ path: screenshotPath, fullPage: true });
        await browser.close();
        res.sendFile(screenshotPath, async (err) => {
            if (err) {
                res.status(500).send('Error sending screenshot');
            } else {
                try {
                    await fs.promises.unlink(screenshotPath);
                } catch (unlinkError) {
                    console.error('Ошибка при удалении файла:', unlinkError);
                }
            }
        });
    } catch (error) {
        console.error('Ошибка при создании скриншота:', error);
        res.status(500).send('Error taking screenshot');
    }
});

app.get('/api/proxy_handler', async (req, res) => {
    const url = req.query.url;
    const apiKey = req.headers['x-api-key']; 
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }
    if (!url) {
        return res.status(400).json({ error: 'Url parameter is required' });
    }

    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' }); 
        const contentType = response.headers['content-type'];
        res.json({
            type: contentType,
            data: response.data.toString('base64') 
        });
    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            if (status === 404) {
                return res.status(404).json({ error: 'URL not found (404)' });
            } else if (status === 403) {
                return res.status(403).json({ error: 'Access forbidden (403)' });
            } else {
                return res.status(status).json({ error: `Request failed with status code ${status}` });
            }
        } else {
            console.error('Ошибка:', error.message);
            res.status(500).json({ error: 'Error retrieving data from the provided URL' });
        }
    }
});


app.listen(4000, () => {
    console.log('Сервер запущен на порту 4000');
});
