import { IoEyeOutline } from "react-icons/io5";
import { LuMessageSquare } from "react-icons/lu";

type IChannelType = {
  name: string;
  profilePicture: string;
  coverPhoto: string;
};

type IVideoType = {
  _id: string;
  url: string;
  tag: string[];
  category: string;
  thumbnail: string;
  title: string;
  uploadAt: string;
  viewCount: number;
  comments: any[];
  channel: IChannelType;
};

type IVideoProps = {
  content: IVideoType;
};

const RecommendedVideo = ({ content }: IVideoProps) => {
  return (
    <div className="p-2">
      <div className="border-2 border-gray-200 border-opacity-60 rounded-lg overflow-hidden flex justify-between items-start">
        <div className="relative">
          <img
            className="lg:h-40 md:h-36 w-96 object-cover object-center"
            src={content.thumbnail}
            alt="blog"
          />
          <p className="absolute bottom-2 right-2 text-white bg-black rounded-[10px] p-1 text-xs">
            10:00
          </p>
        </div>

        <div className="p-2 flex justify-between items-start gap-2 h-40">
          <div>
            {" "}
            <h1 className="font-bold text-md w-full">{content.title}</h1>
            <div className="flex justify-start items-center gap-2 space-y-4">
              {" "}
              <img
                className="lg:h-8 md:h-8 w-8 rounded-full object-cover object-center mt-2"
                src={content.channel.profilePicture}
                alt="blog"
              />
              <h1 className="text-md">{content.channel.name}</h1>
            </div>
            <div className="mt-2">
              <div className="flex items-center flex-wrap ">
                <p>{content?.uploadAt}</p>
                <span className="text-gray-400 mr-3 inline-flex items-center lg:ml-auto md:ml-0 ml-auto leading-none text-sm pr-3 py-1 ">
                  <IoEyeOutline className="mr-1" />
                  1.2K views
                </span>
                <span className="text-gray-400 inline-flex items-center leading-none text-sm">
                  <LuMessageSquare className="mr-1" />6
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecommendedVideo;
