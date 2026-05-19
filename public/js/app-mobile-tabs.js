// ===== Mobile Tabs Management =====
// Controla a exibição/ocultamento das sidebars em mobile

const isMobile = () => window.innerWidth <= 768;
const isSmallMobile = () => window.innerWidth <= 480;

const tabBar = document.getElementById('tabBar');
const chatTab = document.getElementById('chatTab');
const peopleTab = document.getElementById('peopleTab');
const infoTab = document.getElementById('infoTab');

const peoplePane = document.querySelector('.peoplePane');
const infoSidebar = document.querySelectorAll('aside')[document.querySelectorAll('aside').length - 1];
const chat = document.querySelector('.chat');

let currentTab = 'chat';

// Função para mostrar/esconder abas
function switchTab(tabName) {
  // Esconder tudo
  peoplePane.classList.remove('show');
  infoSidebar.classList.remove('show');

  // Remover active de todos os botões
  document.querySelectorAll('.tabButton').forEach(btn => {
    btn.classList.remove('active');
  });

  // Mostrar a aba selecionada
  if (tabName === 'chat') {
    chat.style.display = '';
    chatTab.classList.add('active');
  } else if (tabName === 'people') {
    peoplePane.classList.add('show');
    peopleTab.classList.add('active');
  } else if (tabName === 'info') {
    infoSidebar.classList.add('show');
    infoTab.classList.add('active');
  }

  currentTab = tabName;
}

// Event listeners nos botões de aba
if (chatTab) chatTab.addEventListener('click', () => switchTab('chat'));
if (peopleTab) peopleTab.addEventListener('click', () => switchTab('people'));
if (infoTab) infoTab.addEventListener('click', () => switchTab('info'));

// Mostrar tab bar apenas em mobile
function updateMobileLayout() {
  if (isMobile()) {
    tabBar.style.display = 'flex';
    // Garante que chat esteja visível inicialmente
    if (currentTab === 'chat') {
      chat.style.display = '';
    }
  } else {
    tabBar.style.display = 'none';
    // Desktop: mostrar tudo
    peoplePane.style.display = '';
    infoSidebar.style.display = '';
    chat.style.display = '';
  }
}

// Atualizar layout ao carregar
updateMobileLayout();

// Atualizar layout ao redimensionar
window.addEventListener('resize', updateMobileLayout);

// Inicializar com a aba de chat
if (isMobile()) {
  switchTab('chat');
}
