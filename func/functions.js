class AllFunctions {
    isValidUrl(url) {
        try {
            const parsedUrl = new URL(url);
            const isHttpOrHttps = ['http:', 'https:'].includes(parsedUrl.protocol);
            const isNotLocalhost = parsedUrl.hostname !== 'localhost';
            return isHttpOrHttps && isNotLocalhost;
        } catch {
            return false;
        }
    }

    replaceFontFaceUrls = (cssContent, baseUrl, proxyUrl) => {
            return cssContent.replace(/url\(['"]?(.*?)['"]?\)/g, (match, originalUrl) => {
                const absoluteUrl = new URL(originalUrl, baseUrl).href; // Преобразование относительного пути в абсолютный
                const proxiedUrl = `${proxyUrl}${encodeURIComponent(absoluteUrl)}`;
                return `url('${proxiedUrl}')`;
            });
    };

    async streamToString(stream) {
        const chunks = [];
        return new Promise((resolve, reject) => {
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            stream.on('error', reject);
        });
    }

    replaceFontFaceUrls(cssContent, baseUrl, proxyUrl) {
        return cssContent.replace(/url\(['"]?(.*?)['"]?\)/g, (match, originalUrl) => {
            const absoluteUrl = new URL(originalUrl, baseUrl).href; // Преобразование относительного пути в абсолютный
            const proxiedUrl = `${proxyUrl}${encodeURIComponent(absoluteUrl)}`;
            return `url('${proxiedUrl}')`;
        });
    }

    async getContentType(rootSite, fullUrl) {
        console.log(rootSite, fullUrl);
        if (!rootSite || !fullUrl) {
            throw new Error("Both 'rootSite' and 'fullUrl' parameters are required.");
        }
        try {
            const proxyUrl = `${rootSite}/api/proxy_handler?url=${encodeURIComponent(fullUrl)}`;
            const response = await axios.get(proxyUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': fullUrl,
                    'Connection': 'keep-alive',
                    'Sec-Fetch-Site': 'same-origin',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-User': '?1',
                    'Sec-Fetch-Dest': 'document',
                    'Cache-Control': 'no-cache',
                    'Upgrade-Insecure-Requests': '1',
                },
            });
            const contentType = response.headers['content-type'];
            if (!contentType) {
                throw new Error("Content-Type header is missing in the response.");
            }
            return contentType;
        } catch (error) {
            return 'text/html; charset=utf-8';
        }
    }
}

module.exports = AllFunctions;
