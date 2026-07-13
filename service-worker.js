function configureSidePanelAction() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => {
      console.error("Não foi possível configurar o clique no ícone.", error);
    });
}

configureSidePanelAction();
