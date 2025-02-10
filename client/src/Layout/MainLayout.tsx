import { Outlet } from "react-router-dom";
import "../index.css";

import { useState } from "react";
import NavBar from "@/components/shared/NavBar/NavBar";
import SideBar from "@/components/shared/SideBar/SideBar";
import Footer from "@/components/shared/Footer/Footer";

const MainLayout = () => {
  const [expandSideBar, setExpandSideBar] = useState(false);

  return (
    <div>
      <NavBar
        expandSideBar={expandSideBar}
        setExpandSideBar={setExpandSideBar}
      />
      <div className="flex justify-between items-center w-full">
        <SideBar expandSideBar={expandSideBar} />
        <div className={`${expandSideBar ? "ml-[200px]" : "ml-[70px]"} pt-14 w-full`}>
          <Outlet />
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default MainLayout;
