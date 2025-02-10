import { createContext, useEffect, useState, ReactNode } from "react";
import { instance as axiosInstance } from "@/helpers/axios/axiosInstance";
import { authKey } from "@/constants/storageKey";
import {  setToLocalStorage } from "@/utils/local-storage";
import { removeUserInfo } from "@/services/auth.service";

interface AuthContextProps {
  user: any;
  loading: boolean;
  createUser: (email: string, password: string) => Promise<void>;
  logInUser: (email: string, password: string) => Promise<void>;
  logOutUser: () => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextProps | null>(null);

const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch the current user
  const fetchUser = async () => {
    try {
      const { data } = await axiosInstance.get("/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  // Register new user
  const createUser = async (email: string, password: string) => {
    setLoading(true);
    try {
      await axiosInstance.post("/register", { email, password });
      await fetchUser();
    } finally {
      setLoading(false);
    }
  };

  // Login user
  const logInUser = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await axiosInstance.post("/login", { email, password });
      setToLocalStorage(authKey, data.accessToken);
      await fetchUser();
    } finally {
      setLoading(false);
    }
  };

  // Logout user
  const logOutUser = async () => {
    setLoading(true);
    try {
      await axiosInstance.post("/logout");
    } finally {
      removeUserInfo(authKey);
      setUser(null);
      setLoading(false);
    }
  };

  // Forgot Password
  const forgotPassword = async (email: string) => {
    try {
      await axiosInstance.post("/forgot-password", { email });
    } catch (error) {
      console.error("Forgot password error:", error);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, createUser, logInUser, logOutUser, forgotPassword }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
