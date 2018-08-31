import React from 'react';
import Link from 'next/link';

export default () => (
  <div className='header'>
    <Link href="/"><a>Home</a></Link>
    <style jsx>{`
      .header {
        background: #999;
        padding: 10px 20px;
      }
  `}</style>
  </div>
);
