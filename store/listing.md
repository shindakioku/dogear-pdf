# Chrome Web Store listing

Paste these into the Developer Dashboard. Category: **Tools**. Language: English, with Russian added as a second listing.

## Assets

- Icon: comes from the package
- Screenshots (1280x800): `store/screenshots/`
- Small promo tile (440x280): `store/promo-440x280.png`
- Privacy policy URL: the GitHub address of `PRIVACY.md`

## Description (English)

Close a PDF, come back in a week, and it opens exactly where you stopped. Dogear replaces Chrome's PDF viewer with PDF.js and saves your place as you read, with nothing to click.

• Remembers your page, position on the page, zoom and rotation
• Works with PDFs on the web and on your computer, and a renamed or moved file keeps its place
• History in the toolbar: see your progress and jump back into any PDF
• Sensible default zoom, and the percentage is always visible
• Switch between the file's page numbers and the ones printed in the book
• Press T to hide the toolbar and read without distractions
• Open tabs and tab groups come back after an extension update

Private by design: no account, no servers and no analytics. Your reading history stays on your device, and you can clear it at any time. The code is open source.

To use it with PDFs on your computer, turn on "Allow access to file URLs" in the extension's details.

## Description (Russian)

Закройте PDF, вернитесь через неделю, и он откроется ровно там, где вы остановились. Dogear заменяет просмотрщик PDF в Chrome на PDF.js и сохраняет место сам, нажимать ничего не нужно.

• Запоминает страницу, место на странице, масштаб и поворот
• Работает с PDF из интернета и с компьютера; переименованный или перемещённый файл не теряет позицию
• История на панели браузера: видно прогресс, и можно вернуться к любому PDF
• Удобный масштаб по умолчанию, процент всегда на виду
• Переключение между номерами страниц файла и номерами, напечатанными в книге
• Клавиша T скрывает панель, чтобы ничего не отвлекало
• Открытые вкладки и группы вкладок возвращаются после обновления расширения

Конфиденциально: без аккаунта, серверов и аналитики. История чтения остаётся на вашем устройстве, и её можно очистить в любой момент. Исходный код открыт.

Чтобы работать с PDF на компьютере, включите «Разрешить доступ к URL файлов» в сведениях о расширении.

## Privacy tab

**Single purpose:** Open PDF files in a viewer that remembers the reader's position in each document.

**Permission justifications:**

- `declarativeNetRequestWithHostAccess`: Redirects navigations to PDF files to the extension's built-in viewer, because Chrome's own viewer doesn't let extensions read the current page.
- `storage`: Saves reading positions, reading history and settings on the user's device.
- `tabGroups`: Chrome closes extension pages when an extension updates. The extension reopens PDF tabs afterwards and needs this to restore their tab groups' names and colours.
- Host permission `<all_urls>`: PDFs can be hosted on any site. Needed to detect them by response headers and to download them for display in the viewer, including PDFs that require the user's login. No page content is read or changed.

**Remote code:** No, all code is in the package.

**Data usage:** Don't tick any collected data types: nothing leaves the device, and the developer receives nothing. Tick all three certifications.
