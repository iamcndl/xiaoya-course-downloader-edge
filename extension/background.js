// Downloads run in the visible extension tab, not in this short-lived worker.
chrome.action.onClicked.addListener(async (tab) => {
  const query = Number.isInteger(tab.id) ? `?source=${tab.id}` : '';
  await chrome.tabs.create({url: chrome.runtime.getURL(`app.html${query}`)});
});
