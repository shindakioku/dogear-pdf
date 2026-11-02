# Dogear privacy policy

Dogear doesn't collect, transmit or sell any data. It has no servers, analytics or advertising, and the developer can't see anything you read.

## What is stored on your device

Dogear keeps the following in Chrome's local extension storage (`chrome.storage.local`):

- For each PDF you read: its position, page count, title, address and when you last read it. An address can contain whatever the site put in it, such as an access token in a signed link.
- For each open PDF tab: its address, window, position in the window and tab group, so that it can be reopened after an extension update.
- Your settings: default zoom, page numbering mode and whether the toolbar is hidden.

This data isn't synced between devices. Positions aren't saved in incognito windows.

## Network requests

To show a PDF, Dogear downloads it from the address you opened, using your cookies for that site, in the same way the browser would. It makes no other requests.

## Removing your data

In the toolbar popup, `×` removes one PDF and **Clear history** removes all of them. Uninstalling the extension deletes everything.

## Permissions

- **Access to all sites:** to recognise PDFs on any site and download them for display. Page content on other sites isn't read or changed.
- **Declarative net request:** to send PDF addresses to the built-in viewer.
- **Storage:** to save the data listed above on your device.
- **Tab groups:** to put reopened tabs back into their groups.

## Changes

Changes to this policy are recorded in this repository's history.
