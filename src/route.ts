import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "../../auth/[...nextauth]/route";
import isAdministrator from "@/utils/is-administrator";
import { prisma } from "@/db/connection";
import sendMoodleRequest from "@/utils/moodle-request";
import {
  StudentProps,
  updateEnrollmentStatusIfNecessary,
  updateUserIfNecessary,
} from "../../enrollmentssync/[id]/route";

async function getCourseClass(id: string) {
  return await prisma.courseClass.findUnique({
    where: {
      id,
    },
    include: {
      course_class_administrators: true,
      course: true,
    },
  });
}

async function getStudent(cpf: string) {
  const result = await prisma.student.findUnique({
    where: {
      cpf,
    },
  });

  return result;
}

async function getEnrollment(studentId: string, courseClassId: string) {
  const result = await prisma.enrollment.findUnique({
    where: {
      enrollment: {
        student_id: studentId,
        course_class_id: courseClassId,
      },
    },
    include: {
      student: true,
      enrollment_status: {
        take: 1,
        orderBy: {
          created_at: "desc",
        },
      },
    },
  });

  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { cpf: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 401 });
  }

  const course_id = request.nextUrl.searchParams.get("course_id") as string;
  const courseClass = await getCourseClass(course_id);

  if (!courseClass) {
    return NextResponse.json({ error: "Turma inválida" }, { status: 400 });
  }

  const cpf = params.cpf;

  if (!cpf) {
    return NextResponse.json({ error: "CPF é necessário" }, { status: 400 });
  }

  const isAdmin = await isAdministrator(session.user.email);
  const isCourseAdministrator = courseClass.course_class_administrators.find(
    (item) => item.email === session.user?.email
  );

  if (!isAdmin && !isCourseAdministrator) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  // Consulta se estudante já existe com o CPF como username
  const findUserParams = {
    wstoken: process.env.MOODLE_GET_TOKEN!,
    wsfunction: "core_user_get_users_by_field",
    moodlewsrestformat: "json",
    field: "username",
    "values[0]": cpf,
  };

  const { result: findUserResult, json: findUserJson } =
    await sendMoodleRequest(findUserParams);

  if (!findUserResult.ok) {
    return NextResponse.json(
      { error: "Erro ao tentar buscar o aluno no Moodle" },
      { status: 404 }
    );
  }

  if (!Array.isArray(findUserJson) || findUserJson.length != 1) {
    return NextResponse.json(
      {
        error:
          "Erro na resposta do Moodle, era esperada uma coleção com apenas um aluno",
      },
      { status: 404 }
    );
  }

  const student = await getStudent(cpf);
  if (!student) {
    return NextResponse.json(
      {
        error: "Erro ao tentar buscar Aluno pelo CPF",
      },
      { status: 404 }
    );
  }

  const userData: StudentProps = {
    studentId: student.id,
    cpf: findUserJson[0].email,
    actual: {
      email: student.email,
      name: student.name,
      lastName: student.last_name,
    },
    moodle: {
      email: findUserJson[0].email,
      name: findUserJson[0].firstname,
      lastName: findUserJson[0].lastname,
    },
  };

  const studentData = await updateUserIfNecessary(userData);

  const userId = findUserJson[0].id;
  const findCoursesParams = {
    wstoken: process.env.MOODLE_GET_TOKEN!,
    wsfunction: "core_enrol_get_users_courses",
    moodlewsrestformat: "json",
    userid: userId,
  };

  const { result: findCoursesResult, json: findCoursesJson } =
    await sendMoodleRequest(findCoursesParams);

  if (!findCoursesResult.ok) {
    return NextResponse.json(
      {
        error: "Erro ao tentar buscar inscrições do aluno no Moodle",
        studentData,
      },
      { status: 404 }
    );
  }

  if (!Array.isArray(findCoursesJson)) {
    return NextResponse.json(
      {
        error: "Erro na resposta do Moodle, era esperada uma coleção de cursos",
        studentData,
      },
      { status: 404 }
    );
  }

  if (findCoursesJson.length < 1) {
    return NextResponse.json(
      {
        error: "Aluno não matriculado no curso",
        studentData,
      },
      { status: 404 }
    );
  }

  const index = findCoursesJson.findIndex(
    (course) => course.id == courseClass.course.moodle_id
  );

  if (index < 0) {
    return NextResponse.json(
      {
        error: "Aluno não matriculado no curso",
        studentData,
      },
      { status: 404 }
    );
  }

  const courseLastAccess = findCoursesJson[index].lastaccess;
  const courseProgress = findCoursesJson[index].progress;
  const courseCompleted = findCoursesJson[index].completed;
  const enrollment = await getEnrollment(student.id, courseClass.id);
  if (!enrollment) {
    return NextResponse.json(
      {
        error: "Erro ao buscar matrícula do aluno",
        studentData,
      },
      { status: 500 }
    );
  }
  const newStatus = await updateEnrollmentStatusIfNecessary(
    enrollment.id,
    enrollment.enrollment_status[0].enrollment_status_type,
    courseLastAccess,
    courseCompleted
  );

  return NextResponse.json(
    {
      courseLastAccess,
      courseProgress,
      studentData,
      enrollmentStatus: newStatus,
    },
    { status: 200 }
  );
}
