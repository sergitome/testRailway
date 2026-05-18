const TelegramBot = require('node-telegram-bot-api');
const { chromium } = require('playwright');

const TOKEN = '8900784629:AAF6stVQep2AFOccsvUtqBxyU5iZknoshB8';
console.log('Iniciant bot...');

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log('Bot started');

bot.onText(/\/benzina/, async (msg) => {

    const chatId = msg.chat.id;

    console.log('Comanda /benzina rebuda');

    try {

        console.log('Arrancant navegador...');

        const browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();

        console.log('Consultant web...');

        await page.goto(
            'https://www.komparing.com/es/precio-gasolina-95/illes-balears/palma-de-mallorca',
            {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            }
        );

        console.log('Esperant càrrega de la pàgina...');

        await page.waitForTimeout(8000);

        console.log('Cercant files de la taula...');

        await page.waitForSelector('table tbody tr', {
            timeout: 30000
        });

        const benzineres = await page.$$eval(
            'table tbody tr',
            rows => {

                return rows.map(row => {

                    const cols = row.querySelectorAll('td');

                    if (cols.length < 2) {
                        return null;
                    }

                    const nom = cols[0]
                        .innerText
                        .trim();

                    const preuText = cols[1]
                        .innerText
                        .replace('€', '')
                        .replace(',', '.')
                        .trim();

                    const preu = parseFloat(preuText);

                    if (isNaN(preu)) {
                        return null;
                    }

                    return {
                        nom,
                        preu
                    };
                }).filter(Boolean);
            }
        );

        console.log('Benzineres trobades:', benzineres.length);

        await browser.close();

        if (benzineres.length === 0) {

            await bot.sendMessage(
                chatId,
                'No s’han trobat benzineres'
            );

            return;
        }

        benzineres.sort((a, b) => a.preu - b.preu);

        const top5 = benzineres.slice(0, 5);

        const escapeHtml = (text) => text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

        const buildMapsUrl = (name) =>
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' Palma de Mallorca')}`;

        let resposta = '⛽ TOP 5 benzineres més barates\n\n';

        top5.forEach((b, index) => {
            const url = buildMapsUrl(b.nom);
            resposta += `${index + 1}. <a href="${url}">${escapeHtml(b.nom)}</a> - ${b.preu}€\n`;
        });

        console.log('Enviant resposta...');

        await bot.sendMessage(
            chatId,
            resposta,
            {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            }
        );

        console.log('Resposta enviada');

    } catch (error) {

        console.error('================ ERROR REAL ================');
        console.error(error);
        console.error('============================================');

        await bot.sendMessage(
            chatId,
            'Error obtenint preus'
        );
    }
});