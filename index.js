const { Telegraf, session } = require('telegraf');
const QRCode = require('qrcode');
const { createCanvas, CanvasRenderingContext2D, loadImage } = require('canvas');
const { format } = require('date-fns');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Добавляем middleware для сессий
bot.use(session());

// === БАЗА ДАННЫХ (JSON файл) ===
const DB_PATH = path.join(__dirname, 'subscriptions.json');

// Загрузка базы
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Ошибка загрузки БД:', e);
  }
  return {};
}

// Сохранение базы
function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Инициализация
let subscriptions = loadDB();

const validRoutes = ['1','2','3','4','5','7','10','11','12','15','18','22','28','29','30','34','38','44','50','56','62','65','70','77','79','86','99','201','202','203','204','205','206','207','208','209','210'];

// ID админа (замени на свой Telegram ID)
const ADMIN_ID = process.env.ADMIN_ID || '';

// Расширение для закруглённых углов
CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  this.beginPath();
  this.moveTo(x + r, y);
  this.arcTo(x + w, y, x + w, y + h, r);
  this.arcTo(x + w, y + h, x, y + h, r);
  this.arcTo(x, y + h, x, y, r);
  this.arcTo(x, y, x + w, y, r);
  this.closePath();
  return this;
};

// Главное меню
bot.start((ctx) => ctx.reply('Добро пожаловать в ONAY Pass!\nВыберите действие:', {
  reply_markup: {
    keyboard: [['Купить подписку', 'Сгенерировать билет']],
    resize_keyboard: true
  }
}));

// Функция показа главного меню
function showMainMenu(ctx, text = 'Выберите действие:') {
  ctx.session = {};
  return ctx.reply(text, {
    reply_markup: {
      keyboard: [['Купить подписку', 'Сгенерировать билет']],
      resize_keyboard: true
    }
  });
}

// Купить подписку
bot.hears('Купить подписку', (ctx) => {
  const code = 'ONAY-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  const userId = ctx.from.id;
  subscriptions[code] = { 
    trips_left: 0, 
    activated: false,
    userId: userId,
    createdAt: new Date().toISOString()
  };
  saveDB(subscriptions);
  ctx.reply(`Ваш уникальный код: *${code}*\n\nДля покупки переведите на Kaspi Gold:\nНомер: +7 (XXX) XXX-XX-XX\nВ комментарии обязательно укажите: ${code}\n\nТарифы:\n• 20 поездок — 500 тг\n• 50 поездок — 1000 тг\n• 100 поездок — 1500 тг\n\nПосле перевода напишите @ezkey — активирую подписку!`, { parse_mode: 'Markdown' });
});

// === АДМИН КОМАНДЫ ===
// Активация подписки: /activate ONAY-XXXXXX 20
bot.command('activate', (ctx) => {
  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.reply('❌ Нет доступа');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    return ctx.reply('Использование: /activate КОД ПОЕЗДКИ\nПример: /activate ONAY-ABC123 20');
  }
  
  const code = args[1].toUpperCase();
  const trips = parseInt(args[2]);
  
  if (isNaN(trips) || trips <= 0) {
    return ctx.reply('❌ Укажите корректное количество поездок');
  }
  
  // Если код не найден, создаём новую подписку
  if (!subscriptions[code]) {
    subscriptions[code] = { 
      trips_left: 0, 
      activated: false,
      userId: null,
      createdAt: new Date().toISOString()
    };
  }
  
  subscriptions[code].trips_left += trips;
  subscriptions[code].activated = true;
  subscriptions[code].activatedAt = new Date().toISOString();
  saveDB(subscriptions);
  
  ctx.reply(`✅ Подписка ${code} активирована!\nПоездок: ${subscriptions[code].trips_left}`);
});

// Просмотр всех подписок: /list
bot.command('list', (ctx) => {
  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.reply('❌ Нет доступа');
  }
  
  const codes = Object.keys(subscriptions);
  if (codes.length === 0) {
    return ctx.reply('База пуста');
  }
  
  let text = '📋 *Все подписки:*\n\n';
  codes.forEach(code => {
    const sub = subscriptions[code];
    const status = sub.activated ? '✅' : '⏳';
    text += `${status} \`${code}\` — ${sub.trips_left} поездок\n`;
  });
  
  ctx.reply(text, { parse_mode: 'Markdown' });
});

// Проверка кода: /check ONAY-XXXXXX
bot.command('check', (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Использование: /check КОД');
  }
  
  const code = args[1].toUpperCase();
  const sub = subscriptions[code];
  
  if (!sub) {
    return ctx.reply(`❌ Код ${code} не найден`);
  }
  
  const status = sub.activated ? '✅ Активна' : '⏳ Ожидает оплаты';
  ctx.reply(`📍 Подписка: ${code}\nСтатус: ${status}\nПоездок осталось: ${sub.trips_left}`);
});

// Сгенерировать билет
bot.hears('Сгенерировать билет', (ctx) => {
  if (!ctx.session) ctx.session = {};
  ctx.session.step = 'wait_code';
  ctx.reply('Введите код подписки (ONAY-XXXXXX):');
});

// Логика ввода
bot.on('text', async (ctx) => {
  // Пропускаем команды бота
  if (ctx.message.text && ctx.message.text.startsWith('/')) {
    return;
  }
  
  // Пропускаем кнопки главного меню, если сессия не активна
  if (!ctx.session) ctx.session = {};
  
  if (!ctx.session.step && (ctx.message.text === 'Купить подписку' || ctx.message.text === 'Сгенерировать билет')) {
    return; // Эти кнопки обрабатываются отдельными обработчиками
  }

  if (ctx.session.step === 'wait_code') {
    const code = ctx.message.text.trim().toUpperCase();
    const sub = subscriptions[code];
    
    // Проверка валидности кода
    if (!sub) {
      return showMainMenu(ctx, '❌ Код не найден. Попробуйте снова или купите подписку.');
    }
    if (!sub.activated) {
      return showMainMenu(ctx, '⏳ Подписка ещё не активирована. Ожидайте подтверждения оплаты.');
    }
    if (sub.trips_left <= 0) {
      return showMainMenu(ctx, '❌ Поездки закончились. Купите новую подписку.');
    }
    
    // Код валидный — продолжаем
    ctx.session.code = code;
    ctx.session.step = 'wait_route';
    return ctx.reply(`✅ Код принят! Осталось поездок: ${sub.trips_left}\n\nВведите номер маршрута (например, 201):`);
  }

  if (ctx.session.step === 'wait_route') {
    const route = ctx.message.text.trim();
    if (!validRoutes.includes(route)) {
      return ctx.reply('❌ Недопустимый номер маршрута. Попробуйте ещё раз:');
    }
    ctx.session.route = route;
    ctx.session.step = 'wait_qr';
    return ctx.reply('Введите 7-значный код QR (только цифры):');
  }

  if (ctx.session.step === 'wait_qr') {
    const qrCode = ctx.message.text.trim();
    if (qrCode.length !== 7 || !/^\d+$/.test(qrCode)) {
      return ctx.reply('❌ Код QR должен быть ровно 7 цифр. Попробуйте ещё раз:');
    }

    const code = ctx.session.code;
    if (!code) {
      console.error('Ошибка: код подписки не найден в сессии');
      return showMainMenu(ctx, '❌ Ошибка: код подписки не найден. Начните заново.');
    }
    
    if (!subscriptions[code]) {
      console.error('Ошибка: подписка не найдена в базе:', code);
      return showMainMenu(ctx, '❌ Ошибка: подписка не найдена. Начните заново.');
    }
    
    subscriptions[code].trips_left -= 1;
    saveDB(subscriptions);

    // Генерация случайных кодов
    const routeCode = Math.random().toString(36).substring(2, 9).toUpperCase();
    const verificationCode = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Создание билета по макету
    const canvas = createCanvas(600, 900);
    const c = canvas.getContext('2d');

    const route = ctx.session.route;
    if (!route) {
      console.error('Ошибка: маршрут не найден в сессии');
      return showMainMenu(ctx, '❌ Ошибка: маршрут не найден. Начните заново.');
    }

    // 1. Экран - белый фон
    c.fillStyle = '#FFFFFF';
    c.fillRect(0, 0, 600, 900);

    // 2. Карточка билета - центрирована
    const cardWidth = 480;
    const cardHeight = 760;
    const cardX = (600 - cardWidth) / 2;
    const cardY = (900 - cardHeight) / 2;
    const cardRadius = 70;

    // Фон карточки #D6B5FF
    c.fillStyle = '#D6B5FF';
    c.roundRect(cardX, cardY, cardWidth, cardHeight, cardRadius);
    c.fill();

    // Полукруглые вырезы (Subtract) - создаем маску
    const notchRadius = 18;
    const notchSpacing = 180;
    const notchStartY = cardY + 100;

    // Вырезы слева
    for (let i = 0; i < 4; i++) {
      c.globalCompositeOperation = 'destination-out';
      c.beginPath();
      c.arc(cardX, notchStartY + i * notchSpacing, notchRadius, Math.PI / 2, Math.PI * 3 / 2);
      c.fill();
    }

    // Вырезы справа
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(cardX + cardWidth, notchStartY + i * notchSpacing, notchRadius, -Math.PI / 2, Math.PI / 2);
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';

    // Padding: Top/Bottom 80, Left/Right 60
    const paddingTop = 80;
    const paddingLeft = 60;
    const spacing = 36;
    let yPos = cardY + paddingTop;

    // 3. Блок маршрута (Route Group)
    c.textAlign = 'center';
    
    // Label "Маршрут" - цвет #A78BFA
    c.font = '24px Arial';
    c.fillStyle = '#A78BFA';
    c.fillText('Маршрут', cardX + cardWidth / 2, yPos);
    
    yPos += spacing;

    // Route Row - горизонтальная компоновка: иконка автобуса + Tag Route + Tag Plate
    const routeRowY = yPos;
    const elementSpacing = 12;
    
    // Иконка автобуса
    c.font = 'bold 36px Arial';
    c.fillStyle = '#1A1A1A';
    const busIcon = '🚍';
    const busIconWidth = c.measureText(busIcon).width;
    
    // Tag Route - белый фон, радиус 18, текст "03E"
    const tagRouteText = route + 'E';
    c.font = 'bold 32px Arial';
    const tagRouteTextWidth = c.measureText(tagRouteText).width;
    const tagRoutePadding = 16;
    const tagRouteWidth = tagRouteTextWidth + tagRoutePadding * 2;
    const tagRouteHeight = 44;
    
    // Tag Plate - белый фон, радиус 18, текст routeCode
    c.font = 'bold 28px Arial';
    const tagPlateTextWidth = c.measureText(routeCode).width;
    const tagPlatePadding = 16;
    const tagPlateWidth = tagPlateTextWidth + tagPlatePadding * 2;
    const tagPlateHeight = 44;
    
    // Общая ширина всех элементов
    const totalWidth = busIconWidth + elementSpacing + tagRouteWidth + elementSpacing + tagPlateWidth;
    const routeRowStartX = cardX + (cardWidth - totalWidth) / 2;
    
    // Рисуем иконку автобуса
    c.fillText(busIcon, routeRowStartX + busIconWidth / 2, routeRowY + 12);
    
    // Рисуем Tag Route
    const tagRouteX = routeRowStartX + busIconWidth + elementSpacing;
    const tagRouteY = routeRowY - tagRouteHeight / 2;
    c.fillStyle = '#FFFFFF';
    c.roundRect(tagRouteX, tagRouteY, tagRouteWidth, tagRouteHeight, 18);
    c.fill();
    c.fillStyle = '#1A1A1A';
    c.fillText(tagRouteText, tagRouteX + tagRouteWidth / 2, tagRouteY + tagRouteHeight / 2 + 10);
    
    // Рисуем Tag Plate
    const tagPlateX = tagRouteX + tagRouteWidth + elementSpacing;
    const tagPlateY = routeRowY - tagPlateHeight / 2;
    c.fillStyle = '#FFFFFF';
    c.roundRect(tagPlateX, tagPlateY, tagPlateWidth, tagPlateHeight, 18);
    c.fill();
    c.fillStyle = '#1A1A1A';
    c.fillText(routeCode, tagPlateX + tagPlateWidth / 2, tagPlateY + tagPlateHeight / 2 + 10);

    yPos += 60 + spacing;

    // 4. Блок даты и времени (Datetime Group)
    // Label "Время"
    c.font = '24px Arial';
    c.fillStyle = '#A78BFA';
    c.fillText('Время', cardX + cardWidth / 2, yPos);
    
    yPos += spacing;
    
    // DateTime Row - дата и время в одной строке
    c.font = 'bold 34px Arial';
    c.fillStyle = '#1A1A1A';
    const dateText = format(new Date(), 'dd.MM.yyyy');
    const timeText = format(new Date(), 'HH:mm');
    const dateTimeText = dateText + ' ' + timeText;
    c.fillText(dateTimeText, cardX + cardWidth / 2, yPos);

    yPos += 60 + spacing;

    // 5. Блок кода проверки (CheckCode Group)
    // Label "Код проверки:"
    c.font = '24px Arial';
    c.fillStyle = '#A78BFA';
    c.fillText('Код проверки:', cardX + cardWidth / 2, yPos);
    
    yPos += spacing;
    
    // Код проверки (крупный, bold)
    c.font = 'bold 48px Arial';
    c.fillStyle = '#1A1A1A';
    c.fillText(verificationCode, cardX + cardWidth / 2, yPos);

    yPos += 80;

    // 6. Блок QR-кода (QR Wrapper)
    // QR Background - белый фон, радиус 28, padding 36
    const qrPadding = 36;
    const qrBackgroundRadius = 28;
    const qrSize = 280;
    const qrBackgroundSize = qrSize + qrPadding * 2;
    const qrBackgroundX = cardX + (cardWidth - qrBackgroundSize) / 2;
    const qrBackgroundY = yPos;
    
    // Белый фон для QR
    c.fillStyle = '#FFFFFF';
    c.roundRect(qrBackgroundX, qrBackgroundY, qrBackgroundSize, qrBackgroundSize, qrBackgroundRadius);
    c.fill();
    
    // QR-код внутри
    try {
      console.log('Начинаю генерацию QR-кода для:', qrCode);
      // Генерируем QR-код как буфер для лучшей совместимости
      const qrBuffer = await QRCode.toBuffer(qrCode, { width: qrSize, margin: 1, errorCorrectionLevel: 'M' });
      console.log('QR-код сгенерирован, загружаю изображение...');
      const img = await loadImage(qrBuffer);
      console.log('Изображение загружено, рисую на canvas...');
      // Центрируем QR-код внутри белого фона
      const qrX = qrBackgroundX + qrPadding;
      const qrY = qrBackgroundY + qrPadding;
      c.drawImage(img, qrX, qrY, qrSize, qrSize);
      const buffer = canvas.toBuffer('image/png');
      console.log('Билет создан, отправляю...');
      await ctx.replyWithPhoto({ source: buffer }, { caption: `✅ Билет сгенерирован!\nОсталось поездок: ${subscriptions[code].trips_left}\nДействует 30 мин` });
      console.log('Билет отправлен успешно');
      ctx.session = {}; // Очищаем сессию после успешной генерации
      showMainMenu(ctx);
    } catch (error) {
      console.error('Ошибка генерации билета:', error);
      console.error('Stack trace:', error.stack);
      ctx.session = {}; // Очищаем сессию при ошибке
      await ctx.reply('❌ Ошибка при генерации билета: ' + error.message);
      showMainMenu(ctx);
    }
  }
});

// Глобальная обработка ошибок
bot.catch((err, ctx) => {
  console.error('Ошибка при обработке обновления:', err);
  console.error('Update ID:', ctx.update?.update_id);
  console.error('Stack trace:', err.stack);
  
  // Обработка конфликта (409) - другой экземпляр бота запущен
  if (err.response?.error_code === 409) {
    console.error('⚠️ КРИТИЧЕСКАЯ ОШИБКА: Другой экземпляр бота уже запущен!');
    console.error('⚠️ Убедитесь, что только один экземпляр бота работает.');
    process.exit(1);
  }
  
  try {
    ctx.reply('❌ Произошла ошибка. Попробуйте позже или обратитесь к администратору.');
  } catch (e) {
    console.error('Не удалось отправить сообщение об ошибке:', e);
  }
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`Получен сигнал ${signal}, останавливаю бота...`);
  bot.stop(signal);
  process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Запуск бота
bot.launch().then(() => {
  console.log('Бот запущен — готов к доходу');
}).catch((err) => {
  console.error('Ошибка запуска бота:', err);
  if (err.response?.error_code === 409) {
    console.error('⚠️ Конфликт: другой экземпляр бота уже запущен. Убедитесь, что только один экземпляр работает.');
  }
  process.exit(1);
});