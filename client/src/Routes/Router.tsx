import { createBrowserRouter } from "react-router-dom";
import MainLayout from "../Layout/MainLayout";
import Home from "../pages/Home/Home";
import Login from "../pages/Login/Login";
import RegisterUser from "@/pages/RegisterUser/RegisterUser";
import SingleVideoPage from "@/pages/SingleVideoPage/SingleVideoPage";
import History from "@/pages/History/History";
import MyVideos from "@/pages/MyVideos/MyVideos";
import UploadVideo from "@/pages/UploadVideo/UploadVideo";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <MainLayout />,
    children: [
      {
        path: "/",
        element: <Home />,
      },
      {
        path: "/video/:id",
        element: <SingleVideoPage />,
      },
      {
        path: "/history",
        element: <History />,
      },
      {
        path: "/my-videos",
        element: <MyVideos />,
      },
      {
        path: "/upload-video",
        element: <UploadVideo />,
      },
    ],
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/registration",
    element: <RegisterUser />,
  },
]);
