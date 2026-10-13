import type { MDXRemoteProps } from "next-mdx-remote/rsc";

export const mdxComponents: MDXRemoteProps["components"] = {
  h1: (props) => <h1 className="mb-2 text-2xl font-semibold" {...props} />,
  h2: (props) => <h2 className="mb-2 mt-5 text-xl font-semibold" {...props} />,
  h3: (props) => <h3 className="mb-1 mt-4 text-lg font-semibold" {...props} />,
  h4: (props) => <h4 className="mb-2 mt-4 text-base font-semibold" {...props} />,
  h5: (props) => <h5 className="mb-1 mt-3 text-sm font-semibold opacity-90" {...props} />,
  p: (props) => (
    <p className="mb-4 text-left font-serif text-[18px] leading-[1.6] sm:text-justify opacity-90" {...props} />
  ),
  ul: (props) => <ul className="mb-4 list-disc pl-6" {...props} />,
  li: (props) => (
    <li className="mb-1 font-serif text-[18px] leading-[1.6] opacity-90" {...props} />
  ),
  a: ({ href, ...props }) => {
    const isExternal = typeof href === "string" && /^https?:\/\//.test(href);
    return (
      <a
        href={href}
        className="text-[rgba(88,125,177,1)] underline hover:text-gray-500"
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...props}
      />
    );
  },
  blockquote: (props) => (
    <blockquote
      className="mb-4 border-l-4 pl-4 font-serif text-[18px] italic leading-[1.6] opacity-90"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="mb-4 overflow-x-auto rounded-lg bg-black/5 p-3 font-mono text-[13px] leading-relaxed sm:text-sm"
      {...props}
    />
  ),
  code: (props) => <code className="break-words font-mono text-[0.9em]" {...props} />,
  img: (props) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="mb-4 h-auto max-w-full rounded-lg sm:max-w-xs" {...props} alt={props.alt ?? ""} />
  ),
};
