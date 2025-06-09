// API базовый URL
if (typeof window.API_BASE_URL === 'undefined') {
  window.API_BASE_URL = "/api";
}

// Инициализация страницы
document.addEventListener('DOMContentLoaded', async function() {
  try {
    const token = localStorage.getItem('access_token');
    if (!token) {
      console.error('No access token found');
      window.location.href = 'auth.html';
      return;
    }
    
    // Получаем ID пользователя из localStorage
    const userId = localStorage.getItem('viewMemberUserId');
    if (!userId) {
      console.error('No user ID found');
      showError('Пользователь не найден');
      // Возвращаемся на страницу команды
      window.location.href = 'team.html';
      return;
    }
    
    console.log('Loading profile for user ID:', userId);
    
    // Загружаем профиль пользователя
    await loadUserProfile(userId);
    
    // Очищаем ID из localStorage после использования
    localStorage.removeItem('viewMemberUserId');
    
  } catch (error) {
    console.error('Error initializing view member page:', error);
    showError('Ошибка загрузки профиля пользователя');
  }
});

// Загрузка профиля пользователя
async function loadUserProfile(userId) {
  try {
    const token = localStorage.getItem('access_token');
    console.log('Fetching user profile...');
    
    const response = await fetch(`${window.API_BASE_URL}/users/${userId}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    
    console.log('User profile response status:', response.status);
    
    if (response.ok) {
      const userProfile = await response.json();
      console.log('User profile loaded:', userProfile);
      displayUserProfile(userProfile);
    } else if (response.status === 404) {
      console.log('User not found');
      showError('Пользователь не найден');
      // Возвращаемся на страницу команды
      setTimeout(() => {
        window.location.href = 'team.html';
      }, 2000);
    } else {
      console.error('Failed to fetch user profile:', response.status, response.statusText);
      const errorData = await response.text();
      console.error('Error response:', errorData);
      throw new Error('Failed to fetch user profile');
    }
  } catch (error) {
    console.error('Error loading user profile:', error);
    showError('Ошибка загрузки профиля пользователя');
    // Возвращаемся на страницу команды
    setTimeout(() => {
      window.location.href = 'team.html';
    }, 2000);
  }
}

// Отображение профиля пользователя
function displayUserProfile(userProfile) {
  console.log('Displaying user profile:', userProfile);
  
  // Обновляем изображение персонажа
  const profileImage = document.querySelector('.profile-info .item');
  if (profileImage && userProfile.img) {
    profileImage.innerHTML = `<img src="${userProfile.img}" alt="${userProfile.nickname}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
    profileImage.classList.remove('empty-slot');
  }
  
  // Обновляем никнейм
  const nicknameElement = document.querySelector('.profile-info div[style*="font-size: 20px"]');
  if (nicknameElement) {
    nicknameElement.textContent = userProfile.nickname;
  }
  
  // Обновляем уровень
  const levelElement = document.querySelector('.profile-info div[style*="font-size: 18px"]');
  if (levelElement) {
    levelElement.textContent = `Уровень ${userProfile.level}`;
  }
  
  // Обновляем информацию "О себе"
  const aboutMeText = document.querySelector('.about-me-text');
  if (aboutMeText) {
    if (userProfile.information && userProfile.information.trim()) {
      aboutMeText.textContent = userProfile.information;
    } else {
      aboutMeText.textContent = 'Пользователь не указал информацию о себе.';
    }
  }
  
  console.log('User profile displayed successfully');
}

