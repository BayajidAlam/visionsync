import { IoHomeOutline } from "react-icons/io5";
import { IoVideocamOutline } from "react-icons/io5";
import { FiUpload } from "react-icons/fi";
import { MdHistory } from "react-icons/md";
import { Link } from "react-router-dom";

type SideBarProps = {
  expandSideBar: boolean;
};

const SideBar = ({ expandSideBar }: SideBarProps) => {
  return (
    <div
      className={`fixed top-14 h-screen transition-width duration-200 ${
        expandSideBar ? "w-[180px]" : ""
      } border-r-2 ml-4`}
    >
      {expandSideBar ? (
        <>
          <div className="mx-1 space-y-3 mt-3">
            <Link
              to="/"
              className="hover:bg-slate-200
         p-1 m-1 rounded flex justify-start items-center gap-2"
            >
              <IoHomeOutline className="text-2xl" />
              <p className="text-md font-bold">Home</p>
            </Link>

            <Link
              to="/history"
              className="hover:bg-slate-200
         p-1 m-1 rounded flex justify-start items-center gap-2"
            >
              {" "}
              <MdHistory className="text-2xl" />
              <p className="text-md font-bold">History</p>
            </Link>

            <Link
              to="/my-videos"
              className="hover:bg-slate-200
         p-1 m-1 rounded flex justify-start items-center gap-2"
            >
              <IoVideocamOutline className="text-2xl" />
              <p className="text-md font-bold">My Videos</p>
            </Link>

            <Link
              to="/upload-video"
              className="hover:bg-slate-200
         p-1 m-1 rounded flex justify-start items-center gap-2"
            >
              <FiUpload className="text-2xl" />
              <p className="text-md font-bold">Upload Video</p>
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className="mx-1 space-y-3 mt-3">
            <Link to="/">
              <div
                className="hover:bg-slate-200
             p-1 my-3 rounded"
              >
                <IoHomeOutline className="text-2xl" />
              </div>
            </Link>
            <Link to="/history">
              <div
                className="hover:bg-slate-200
             p-1 my-3 rounded"
              >
                <MdHistory className="text-2xl" />
              </div>
            </Link>
            <Link to="/my-videos">
              <div
                className="hover:bg-slate-200
             p-1 my-3 rounded"
              >
                <IoVideocamOutline className="text-2xl" />
              </div>
            </Link>
            <Link to="upload-video">
              <div
                className="hover:bg-slate-200
             p-1 my-3 rounded"
              >
                <FiUpload className="text-2xl" />
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
};

export default SideBar;
