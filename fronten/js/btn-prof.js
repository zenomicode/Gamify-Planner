document.addEventListener('DOMContentLoaded', function() {
  // API базовый URL
  if (typeof window.window.API_BASE_URL === 'undefined') {
    window.window.API_BASE_URL = "/api"; // Use window object to avoid redeclaration
  }
  const WS_PROTOCOL = window.location.protocol === "https:" ? "wss" : "ws";
  const WS_BASE_URL = `${WS_PROTOCOL}://${window.location.host}${window.window.API_BASE_URL}`; // Using window.API_BASE_URL for WebSocket URL


  // Редактирование "О себе"
  const setupEditModal = () => {
    const editBtn = document.getElementById('edit-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const saveBtn = document.getElementById('save-btn');
    const editModal = document.getElementById('edit-modal');
    const aboutMeText = document.getElementById('about-me-text');
    const editTextarea = document.getElementById('edit-textarea');

    if (!editBtn || !editModal) return;

    editBtn.addEventListener('click', function() {
      editTextarea.value = aboutMeText.textContent;
      editModal.style.display = 'flex';
    });

    cancelBtn.addEventListener('click', closeModal);
    
    saveBtn.addEventListener('click', async function() {
      const newInfo = editTextarea.value.trim();
      
      try {
        const token = localStorage.getItem('access_token');
        if (!token) {
          alert('Вы не авторизованы');
          window.location.href = 'auth.html';
          return;
        }
        
        const response = await fetch(`${API_BASE_URL}/users/me`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            information: newInfo
          })
        });
        
        if (response.ok) {
          const userData = await response.json();
          aboutMeText.textContent = userData.information || '';
          closeModal();
        } else {
          const errorData = await response.json();
          alert(`Ошибка: ${errorData.detail || 'Не удалось обновить информацию'}`);
        }
      } catch (error) {
        console.error('Ошибка при обновлении информации:', error);
        alert('Произошла ошибка при обновлении информации');
      }
    });
    
    editModal.addEventListener('click', function(e) {
      if (e.target === editModal) closeModal();
    });

    function closeModal() {
      editModal.style.display = 'none';
    }
  };

  // Редактирование никнейма
  const setupNicknameModal = () => {
    const editBtn = document.getElementById('edit_nickname-btn');
    const cancelBtn = document.getElementById('cancel-nickname-btn');
    const saveBtn = document.getElementById('save-nickname-btn');
    const nicknameModal = document.getElementById('nickname-modal');
    const nicknameInput = document.getElementById('nickname-input');
    const headerNickname = document.querySelector('.header1 .user-name');

    if (!editBtn || !nicknameModal) return;

    // Получаем текущий никнейм из API при открытии модального окна
    editBtn.addEventListener('click', async function() {
      try {
        const token = localStorage.getItem('access_token');
        if (!token) {
          alert('Вы не авторизованы');
          window.location.href = 'auth.html';
          return;
        }
        
        const response = await fetch(`${API_BASE_URL}/users/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const userData = await response.json();
          nicknameInput.value = userData.nickname || '';
          nicknameModal.style.display = 'flex';
          nicknameInput.focus();
        } else {
          alert('Не удалось получить данные пользователя');
        }
      } catch (error) {
        console.error('Ошибка при получении данных пользователя:', error);
        alert('Произошла ошибка при получении данных пользователя');
      }
    });

    cancelBtn.addEventListener('click', closeModal);
    
    saveBtn.addEventListener('click', async function() {
      const newNickname = nicknameInput.value.trim();
      if (!newNickname) {
        alert('Никнейм не может быть пустым');
        return;
      }
      
      try {
        const token = localStorage.getItem('access_token');
        if (!token) {
          alert('Вы не авторизованы');
          window.location.href = 'auth.html';
          return;
        }
        
        const response = await fetch(`${API_BASE_URL}/users/me`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            nickname: newNickname
          })
        });
        
        if (response.ok) {
          const userData = await response.json();
          // Обновляем никнейм в шапке
          if (headerNickname) {
            headerNickname.textContent = userData.nickname || 'Игрок';
          }
          closeModal();
          
          // Перезагружаем страницу для обновления всех данных
          window.location.reload();
        } else {
          const errorData = await response.json();
          alert(`Ошибка: ${errorData.detail || 'Не удалось обновить никнейм'}`);
        }
      } catch (error) {
        console.error('Ошибка при обновлении никнейма:', error);
        alert('Произошла ошибка при обновлении никнейма');
      }
    });
    
    nicknameModal.addEventListener('click', function(e) {
      if (e.target === nicknameModal) closeModal();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && nicknameModal.style.display === 'flex') {
        closeModal();
      }
    });

    function closeModal() {
      nicknameModal.style.display = 'none';
    }
  };

  // Подтверждение удаления аккаунта
  const setupDeleteModal = () => {
    const deleteBtn = document.getElementById('delete-btn');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const deleteModal = document.getElementById('delete-modal');

    if (!deleteBtn || !deleteModal) return;

    deleteBtn.addEventListener('click', function() {
      deleteModal.style.display = 'flex';
    });

    cancelDeleteBtn.addEventListener('click', closeModal);
    
    confirmDeleteBtn.addEventListener('click', async function() {
      try {
        const token = localStorage.getItem('access_token');
        if (!token) {
          alert('Вы не авторизованы');
          window.location.href = 'auth.html';
          return;
        }
        
        const response = await fetch(`${API_BASE_URL}/users/me`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          // Удаляем токен и перенаправляем на страницу авторизации
          localStorage.removeItem('access_token');
          alert('Аккаунт успешно удален');
          window.location.href = 'auth.html';
        } else {
          const errorData = await response.json();
          alert(`Ошибка: ${errorData.detail || 'Не удалось удалить аккаунт'}`);
        }
      } catch (error) {
        console.error('Ошибка при удалении аккаунта:', error);
        alert('Произошла ошибка при удалении аккаунта');
      }
      
      closeModal();
    });
    
    deleteModal.addEventListener('click', function(e) {
      if (e.target === deleteModal) closeModal();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && deleteModal.style.display === 'flex') {
        closeModal();
      }
    });

    function closeModal() {
      deleteModal.style.display = 'none';
    }
  };

  // Выход из аккаунта
  const setupExitButton = () => {
    const exitBtn = document.getElementById('exit-btn');
    
    if (!exitBtn) return;
    
    exitBtn.addEventListener('click', function() {
      // Удаляем токен из localStorage
      localStorage.removeItem('access_token');
      
      // Перенаправляем на страницу авторизации
      window.location.href = 'auth.html';
    });
  };

  // Загрузка данных пользователя при загрузке страницы
  const loadUserData = async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) {
        window.location.href = 'auth.html';
        return;
      }
      
      const response = await fetch(`${API_BASE_URL}/users/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const userData = await response.json();
        
        // Заполняем поле "О себе"
        const aboutMeText = document.getElementById('about-me-text');
        if (aboutMeText) {
          aboutMeText.textContent = userData.information || 'Информация отсутствует';
        }
        
        // Заполняем поле никнейма в модальном окне
        const nicknameInput = document.getElementById('nickname-input');
        if (nicknameInput) {
          nicknameInput.value = userData.nickname || '';
        }
      } else {
        console.error('Не удалось получить данные пользователя');
        if (response.status === 401) {
          localStorage.removeItem('access_token');
          window.location.href = 'auth.html';
        }
      }
    } catch (error) {
      console.error('Ошибка при загрузке данных пользователя:', error);
    }
  };

  // Инициализация всех модальных окон и кнопок
  setupEditModal();
  setupNicknameModal();
  setupDeleteModal();
  setupExitButton();
  loadUserData();
});
