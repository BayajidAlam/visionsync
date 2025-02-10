import axios from "axios";
import { getNewAccessToken } from "@/services/auth.service";
import { authKey } from "@/constants/storageKey";
import { getFromLocalStorage, setToLocalStorage } from "@/utils/local-storage";

const instance = axios.create({
  baseURL: "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  timeout: 60000,
  withCredentials: true, 
});

// 🚀 Request Interceptor: Attach Authorization Header
instance.interceptors.request.use(
  (config) => {
    const accessToken = getFromLocalStorage(authKey);
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 🚀 Response Interceptor: Handle Token Refresh
instance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // 🔄 If 403 (Forbidden) and not retried yet, try refreshing the token
    if (error.response?.status === 403 && !originalRequest._retry) {
      originalRequest._retry = true; // Mark it as retried
      
      try {
        const response = await getNewAccessToken();
        const newAccessToken = response?.data?.accessToken;

        if (newAccessToken) {
          setToLocalStorage(authKey, newAccessToken);
          originalRequest.headers["Authorization"] = `Bearer ${newAccessToken}`;
          return instance(originalRequest)
        }
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export { instance };
