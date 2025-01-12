const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs'); 
const os = require('os'); 
const cheerio = require('cheerio');
const app = express();
const ip = require('ip');
const { URL } = require('url');

const RoutesM = require('./routes');
const API_KEY = 'your-secret-api-key'; 
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
app.use(express.json());


class HostHandler {
    constructor(rootSite) {
        this.app = express();
        this.rootSite = rootSite;
    }

    routes() {
        this.app.get('/api/screenshot', async (req, res) => {
            this.Routes.screenshot(req, res);
        });

        this.app.get('/api/full_page', async (req, res) => {
            this.Routes.full_page(req, res);
        });


        this.app.get('/api/proxy_handler', async (req, res) => {
            this.Routes.proxy_handler_get(req, res);
        });
        
        this.app.post('/api/proxy_handler', async (req, res) => {
            this.Routes.proxy_handler_post(req, res);
        });
    }

    async start(port) {
        this.Routes = new RoutesM(this.browser, this.rootSite);
        console.log(`[HostHandler][Routes] Успех.`);
        this.routes();
        console.log(`[HostHandler][routes] Успех.`);
        this.app.set('trust proxy', true);
        this.app.listen(port, () => {
            console.log(`[HostHandler][start] Сервер запущен на http://localhost:${port}`);
        });
    }
    

    async initializeBrowser() {
        this.browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        console.log('[HostHandler][initializeBrowser] Браузер запущен.');
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            console.log('[HostHandler][initializeBrowser] Браузер закрыт.');
        }
    }
}

module.exports = HostHandler;