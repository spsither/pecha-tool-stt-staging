"use server";

import prisma from "@/service/db";
import { revalidatePath } from "next/cache";
import { getReviewerTaskCount, getUserSpecificTasksCount } from "./task";

export const getAllUser = async () => {
  try {
    const users = await prisma.user.findMany({
      include: {
        _count: {
          select: {
            transcriber_task: true,
            reviewer_task: true,
            final_reviewer_task: true,
          },
        },
        group: true,
      },
    });
    return users;
  } catch (error) {
    console.error("Error getting all the user:", error);
    throw new Error(error);
  }
};

export const createUser = async (formData) => {
  const name = formData.get("name");
  const email = formData.get("email");
  const groupId = formData.get("group_id");
  const role = formData.get("role");
  try {
    // check if username  and email already exists
    const userByName = await prisma.user.findUnique({
      where: {
        name: name,
      },
    });

    const userByEmail = await prisma.user.findUnique({
      where: {
        email: email,
      },
    });

    if (userByName && userByEmail) {
      return {
        error: "User already exists with the same username and email",
      };
    } else if (userByName) {
      return {
        error: "User already exists with the same username",
      };
    } else if (userByEmail) {
      return {
        error: "User already exists with the same email",
      };
    }
    // If no matching user was found, you can proceed with user creating new user
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        group_id: parseInt(groupId),
        role,
      },
    });
    revalidatePath("/dashboard/user");
    // if new user is created, send msg to client side that user is created
    if (newUser) {
      return {
        success: "User created successfully",
      };
    } else {
      return {
        error: "Error creating user",
      };
    }
  } catch (error) {
    console.log("Error adding a user", error);
    throw new Error(error);
  }
};

export const deleteUser = async (id) => {
  try {
    const user = await prisma.user.delete({
      where: {
        id,
      },
    });
    revalidatePath("/dashboard/user");
    return user;
  } catch (error) {
    console.log("Error deleting a user", error);
    throw new Error(error);
  }
};

export const editUser = async (id, formData) => {
  const name = formData.get("name");
  const email = formData.get("email");
  const groupId = formData.get("group_id");
  const role = formData.get("role");
  try {
    // check if username  and email already exists
    const userId = parseInt(id); // Ensure id is converted to an integer
    const userByName = await prisma.user.findUnique({
      where: {
        name: name,
        NOT: {
          id: userId,
        },
      },
    });

    const userByEmail = await prisma.user.findUnique({
      where: {
        email: email,
        NOT: {
          id: userId,
        },
      },
    });

    if (userByName && userByEmail) {
      return {
        error: "User already exists with the same username and email",
      };
    } else if (userByName) {
      return {
        error: "User already exists with the same username",
      };
    } else if (userByEmail) {
      return {
        error: "User already exists with the same email",
      };
    }
    const updatedUser = await prisma.user.update({
      where: {
        id,
      },
      data: {
        name,
        email,
        group_id: parseInt(groupId),
        role,
      },
    });
    revalidatePath("/dashboard/user");
    // if user data is edited , send msg to client side that user is created
    if (updatedUser) {
      return {
        success: "User edited successfully",
      };
    } else {
      return {
        error: "Error editing user",
      };
    }
  } catch (error) {
    console.log("Error updating a user details", error);
    throw new Error(error);
  }
};

export const getUsersByGroup = async (groupId) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        group_id: parseInt(groupId),
        role: "TRANSCRIBER",
      },
      include: {
        transcriber_task: true,
      },
    });
    return users;
  } catch (error) {
    console.error("Error getting users by group:", error);
    throw new Error(error);
  }
};

export const generateUserReportByGroup = async (groupId, dates) => {
  console.log(
    "generateUserReportByGroup called with group id and dates",
    groupId,
    dates
  );
  const { from: fromDate, to: toDate } = dates;
  try {
    const users = await getUsersByGroup(groupId);
    const usersReport = generateUserTaskReport(users, fromDate, toDate);
    return usersReport;
  } catch (error) {
    console.error("Error getting users by group:", error);
    throw new Error(error);
  }
};

/**
 * Generates a report of user task statistics.
 * @param {Array} users - An array of user objects.
 * @returns {Array} - An array of user objects with task statistics.
 */
export const generateUserTaskReport = async (users, fromDate, toDate) => {
  const userList = [];
  let filteredTasks = [];

  for (const user of users) {
    const { id, name, transcriber_task } = user;
    filteredTasks = transcriber_task;

    const userObj = {
      id,
      name,
      noSubmitted: 0,
      noReviewed: 0,
      reviewedSecs: 0,
      syllableCount: 0,
    };

    const taskSubmittedCount = await getUserSpecificTasksCount(id, {
      from: fromDate,
      to: toDate,
    });
    userObj.noSubmitted = taskSubmittedCount;

    if (fromDate && toDate) {
      filteredTasks = filterTasksByDateRange(
        user.transcriber_task,
        fromDate,
        toDate
      );
    }

    const userStatistics = generateUserStatistics(userObj, filteredTasks);
    userList.push(userStatistics);
  }
  return userList;
};

// Generate user task statistics
const generateUserStatistics = (userObj, filteredTasks) => {
  for (const task of filteredTasks) {
    if (task.state === "accepted" || task.state === "finalised") {
      userObj.noReviewed++;
      userObj.reviewedSecs = userObj.reviewedSecs + task.audio_duration;

      //go through each task and find the reviewed transcript and calculate the syllable count
      const { reviewed_transcript } = task;
      const syllableCount = splitIntoSyllables(reviewed_transcript).length;
      userObj.syllableCount = userObj.syllableCount + syllableCount;
    }
  }
  return userObj;
};

export const splitIntoSyllables = (transcript) => {
  // Split the text into syllables using regular expressions
  const syllables = transcript.split(/[\\s་།]+/);
  // Filter out empty syllables
  const filteredSplit = syllables.filter((s) => s !== "");
  return filteredSplit;
};

// Filter tasks within a date range
const filterTasksByDateRange = (tasks, fromDate, toDate) => {
  const isoFromDate = new Date(fromDate);
  const isoToDate = new Date(toDate);

  const filteredTasks = tasks.filter((task) => {
    const reviewedAt = task.reviewed_at;
    // Convert the dates to timestamps for comparison
    const reviewedAtTimestamp = reviewedAt?.getTime();
    const fromDateTimestamp = isoFromDate?.getTime();
    const toDateTimestamp = isoToDate?.getTime();

    return (
      fromDateTimestamp <= reviewedAtTimestamp &&
      reviewedAtTimestamp <= toDateTimestamp
    );
  });
  return filteredTasks;
};

export const reviewerOfGroup = async (groupId) => {
  try {
    const reviewers = await prisma.user.findMany({
      where: {
        group_id: parseInt(groupId),
        role: "REVIEWER",
      },
    });
    return reviewers;
  } catch (error) {
    console.error("Error getting reviewers of group:", error);
    throw new Error(error);
  }
};

// for all the reviewers of a group retun the task statistics - task reviewed, task accepted, task finalised
export const generateReviewerReportbyGroup = async (groupId, dates) => {
  console.log(
    "generateReviewerReportbyGroup called with group id and dates",
    groupId,
    dates
  );
  try {
    const reviewers = await reviewerOfGroup(groupId);
    const usersReport = generateReviewerTaskReport(reviewers, dates);
    return usersReport;
  } catch (error) {
    console.error("Error getting users by group:", error);
    throw new Error(error);
  }
};

export const generateReviewerTaskReport = async (reviewers, dates) => {
  const reviewerList = [];

  for (const reviewer of reviewers) {
    const { id, name } = reviewer;

    const reviewerObj = {
      id,
      name,
      noReviewed: 0,
      noAccepted: 0,
      noFinalised: 0,
    };
    const updatedReviwerObj = await getReviewerTaskCount(
      id,
      dates,
      reviewerObj
    );
    reviewerList.push(updatedReviwerObj);
  }
  console.log("Generated Reviewer Task Statistics Report:", reviewerList);
  return reviewerList;
};

// // might be able to use this function to get the user statistics insteadof generateUserStatistics
// export const userStatistics = async (userId) => {
//   const userData = await prisma.task.findMany({
//     where: {
//       OR: [
//         { transcriber_id: parseInt(userId) },
//         { reviewer_id: parseInt(userId) },
//         { final_reviewer_id: parseInt(userId) },
//       ],
//     },
//     include: {
//       transcriber: true,
//     },
//   });
//   console.log("userData 2", userData.length);
//   const userTaskSummary = userData.reduce(
//     (acc, task) => {
//       if (
//         task.state === "submitted" ||
//         task.state === "accepted" ||
//         task.state === "finalised"
//       ) {
//         acc.noSubmitted++;
//       }
//       if (task.state === "accepted" || task.state === "finalised") {
//         acc.noReviewed++;
//         const syllableCount = splitIntoSyllables(
//           task.reviewed_transcript
//         ).length;
//         acc.syllableCount = acc.syllableCount + syllableCount;
//       }
//       return acc;
//     },
//     { noSubmitted: 0, noReviewed: 0, reviewedMins: 0, syllableCount: 0 }
//   );
//   console.log("userTaskSummary", userTaskSummary);
//   const userStatistics = {
//     ...userTaskSummary,
//     id: userData[0]?.transcriber?.id,
//     name: userData[0]?.transcriber?.name,
//   };
//   console.log("userStatistics", userStatistics);
// };
