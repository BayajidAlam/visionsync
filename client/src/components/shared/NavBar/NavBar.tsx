/* eslint-disable @typescript-eslint/ban-ts-comment */
import { AuthContext } from "@/providers/AuthProvider";
import React, { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { IoMenu } from "react-icons/io5";
import { RxCross2 } from "react-icons/rx";
import { cn } from "@/lib/utils";
import { NavigationMenuLink } from "@/components/ui/navigation-menu";
import { IoMdNotificationsOutline } from "react-icons/io";
import userImage from "../../../assets/IMG_0198.jpg";

type NavBarProps = {
  expandSideBar: boolean;
  setExpandSideBar: (expand: boolean) => void;
};

const NavBar = ({ expandSideBar, setExpandSideBar }: NavBarProps) => {
  // @ts-ignore
  const { user, logOutUser } = useContext(AuthContext);
  const [expand, setExpand] = useState(false);

  const handleLogOut = () => {
    logOutUser()
      .then(() => {})
      .catch((error: any) => {
        console.log(error);
      });
  };

  return (
    <div className="border-b-2 py-2 px-2  w-full list-none h-14 fixed z-[1000] bg-white">
      <div className=" mx-auto md:flex justify-between items-center hidden">
        <div className="flex justify-start items-center gap-4 ml-4">
          <button
            className="hover:bg-slate-200
         p-1 m-1 rounded-full"
            onClick={() => setExpandSideBar(!expandSideBar)}
          >
            <IoMenu className="text-3xl" />
          </button>
          <Link to="/">
            <h1 className="text-green font-bold  text-xl">
              VisionSync
            </h1>
          </Link>
        </div>

        <div className="flex justify-end items-center mr-8">
          <div className="flex justify-end items-center gap-4 text-lg text-green mr-1">
            <button className="hover:bg-slate-200
         p-1 m-1 rounded-full">
              <IoMdNotificationsOutline className="text-2xl" />
            </button>
            <img className="h-8 w-8 rounded-full" src={userImage} />
          </div>
        </div>
      </div>

      {/* small device  */}
      <div className="container mx-auto md:hidden justify-between items-center flex">
        <h1 className="text-green font-bold  text-xl">VisionSync</h1>
        <div onClick={() => setExpand(!expand)} className="text-3xl">
          <IoMenu />
        </div>
      </div>
      {expand && (
        <div className="flex flex-col justify-end items-center text-lg text-green absolute top-0 left-0 w-full z-50 bg-slate-500  rounded md:hidden animate-in duration-1000">
          <Link
            className="text-xl text-center bg-black w-full p-1 mx-auto text-white"
            to={"/"}
          >
            Home
          </Link>
          <Link
            className="text-xl text-center bg-black w-full p-1 mx-auto text-white"
            to={"/dashboard"}
          >
            Dashboard
          </Link>
          <Link
            className="text-xl text-center bg-black w-full p-1 mx-auto text-white"
            to={"/create-types"}
          >
            Create types
          </Link>
          <Link
            className="text-xl text-center bg-black w-full p-1 mx-auto text-white"
            to={"/change-password"}
          >
            Change password
          </Link>

          <button
            onClick={handleLogOut}
            className="text-xl bg-black w-full p-2 mx-auto text-white"
          >
            Logout
          </button>
          <button
            className="text-3xl bg-black w-full p-2 mx-auto"
            onClick={() => setExpand(!expand)}
          >
            <RxCross2 className="text-center w-full text-white " />
          </button>
        </div>
      )}
    </div>
  );
};

export default NavBar;

const ListItem = React.forwardRef<
  React.ElementRef<"a">,
  React.ComponentPropsWithoutRef<"a">
>(({ className, title, children, ...props }, ref) => {
  return (
    <li>
      <NavigationMenuLink asChild>
        <a
          ref={ref}
          className={cn(
            "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
            className
          )}
          {...props}
        >
          <div className="text-sm font-medium leading-none">{title}</div>
          <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
            {children}
          </p>
        </a>
      </NavigationMenuLink>
    </li>
  );
});
ListItem.displayName = "ListItem";
