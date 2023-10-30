import { db } from "@/db";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { createUploadthing, type FileRouter } from "uploadthing/next";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import {  pinecone} from "@/lib/pinecone";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { PineconeStore } from "langchain/vectorstores/pinecone";

const f = createUploadthing();

const middleware = async () => {
  const { getUser } = getKindeServerSession();
  const user = getUser();
  if (!user || !user.id) {
    throw new Error("Unauthorized");
  }

  //const subscriptionPlan = await getUserSubscriptionPlan();

  return { userId: user.id };
};
    const onUploadComplete = async ({
      metadata,
      file,
    }: {
      metadata: Awaited<ReturnType<typeof middleware>>;
      file: {
        key: string;
        name: string;
        url: string;
      };
    }) => {
      const isFileExists = await db.file.findFirst({
        where: {
          key: file.key,
        },
      });

      if (isFileExists) return;

      const createdFile = await db.file.create({
        data: {
          key: file.key,
          userId: metadata.userId,
          url: `https://uploadthing-prod.s3.us-west-2.amazonaws.com/${file.key}`,
          name: file.name,
          uploadStatus: "PROCESSING",
        },
      });

      try {
        const response = await fetch(
          `https://uploadthing-prod.s3.us-west-2.amazonaws.com/${file.key}`
        );
        const blob = await response.blob();
        const loader = new PDFLoader(blob);
        const pageLevelDocs = (await loader.load()).map((doc) => {
          return {
            ...doc,
            metadata: {
              ...doc.metadata,
              "file.id": createdFile.id,
            },
          };
        });

        const pagesAmt = pageLevelDocs.length;
        const pineconeIndex = await pinecone
          .Index("quill")
          .namespace(metadata.userId);

        const embeddings = new OpenAIEmbeddings({
          openAIApiKey: process.env.OPENAI_API_KEY,
        });

        await PineconeStore.fromDocuments(pageLevelDocs, embeddings, {
          pineconeIndex,
        });

        await db.file.update({
          data: {
            uploadStatus: "SUCCESS",
          },
          where: {
            id: createdFile.id,
          },
        });
      } catch (error) {
        console.log("error: ", error);
        await db.file.update({
          data: {
            uploadStatus: "FAILED",
          },
          where: {
            id: createdFile.id,
          },
        });
      }
    };

  export const ourFileRouter = {
    pdfUploader: f({ pdf: { maxFileSize: "4MB" } })
      .middleware(middleware)
      .onUploadComplete(onUploadComplete)
  } satisfies FileRouter;

    export type OurFileRouter = typeof ourFileRouter;
