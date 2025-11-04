// PAGE D'INSCRIPTION

import { Presence } from '../websocket.js';

export function getSignUpHTML(): string {
  return `
  <div class="flex flex-col items-center justify-center min-h-screen">
    <h1 class="page-title-large page-title-brown">Sign Up</h1>
    <div class="form-box-auth">
      <form id="signUpForm" class="space-y-4">
        <div>
          <label for="username" class="auth-label">Username</label>
          <input type="text" id="username" name="username" required
            class="styled-input"
            placeholder="Enter your username">
        </div>
        
        <div>
          <label for="email" class="auth-label">Email</label>
          <input type="email" id="email" name="email" required
            class="styled-input"
            placeholder="Enter your email">
        </div>
        
        <div>
          <label for="password" class="auth-label">Password</label>
          <input type="password" id="password" name="password" required
            class="styled-input"
            placeholder="Enter your password">
        </div>
        
        <button type="submit" id="signUpSubmit"
          class="retro-btn w-full">
          Create Account
        </button>
      </form>
      
      <div class="mt-6 text-center auth-navigation-container">
        <span class="auth-navigation-text">Already have an account? </span>
        <a href="#/login" class="auth-navigation-link">Login here</a>
      </div>
    </div>
    
    <div class="mt-6 text-center">
      <button id="backToMenuSignup" class="retro-btn-small hover-blue">
        Back to Menu
      </button>
    </div>
  </div>
  `;
}

export function attachSignUpEvents() {
  const signUpForm = document.getElementById('signUpForm') as HTMLFormElement;
  
  signUpForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(signUpForm);
    const username = formData.get('username') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    
    if (!username || !email || !password) {
      alert('All fields are required');
      return;
    }
    
    try {
      const response = await fetch('/api/users/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        if (data.token) {
          localStorage.setItem('token', data.token);
          Presence.connect(data.token);
        }
        localStorage.setItem('currentUsername', username);
        location.hash = '#/profile';
      } else {
        alert('Registration failed: ' + (data.error || 'Please try again'));
      }
    } catch (error) {
      alert('Network error. Please try again.');
    }
  });
  
  document.getElementById("backToMenuSignup")?.addEventListener("click", () => {
    location.hash = '';
  });
}

export function renderSignUpPage() {
  const root = document.getElementById("app");
  if (!root) return;

  root.innerHTML = getSignUpHTML();
  attachSignUpEvents();
}
