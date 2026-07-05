import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getDb } from '@/lib/db';
import bcrypt from 'bcryptjs';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error('Please enter both username and password.');
        }

        const sql = getDb();
        
        let users;
        try {
          users = await sql`
            SELECT id, username, password_hash, email FROM users 
            WHERE username = ${credentials.username} 
            LIMIT 1
          `;
        } catch (dbErr) {
          console.error('Database error during auth lookup:', dbErr);
          throw new Error('Database connection issue.');
        }

        if (!users || users.length === 0) {
          throw new Error('No user found with this username.');
        }

        const user = users[0];
        const isValid = bcrypt.compareSync(credentials.password, user.password_hash);

        if (!isValid) {
          throw new Error('Incorrect password.');
        }

        return {
          id: String(user.id),
          name: user.username,
          email: user.email
        };
      }
    })
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60 // 30 days
  },
  pages: {
    signIn: '/login',
    error: '/login'
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id;
        session.user.username = token.username;
      }
      return session;
    }
  },
  secret: process.env.NEXTAUTH_SECRET
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
export default handler;
